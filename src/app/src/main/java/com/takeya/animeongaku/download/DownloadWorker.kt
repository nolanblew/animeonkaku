package com.takeya.animeongaku.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.takeya.animeongaku.R
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadItemDao
import com.takeya.animeongaku.data.local.DownloadItemEntity
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.isServerUrl
import com.takeya.animeongaku.network.rebaseServerMediaUrl
import com.takeya.animeongaku.network.serverMediaRequestHeaders
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

internal const val DOWNLOAD_MAX_ATTEMPTS = 3
internal const val DOWNLOAD_MAX_PARALLEL_TRANSFERS = 6
private const val MAX_BATCH_ATTEMPTS = 5
private const val MAX_WARMUP_WAIT_MS = 45_000L

internal enum class AudioWarmupDecision { READY, FAILED, WAIT }
internal enum class ServerAudioReadiness { PROCEED, FAILED, RETRY_LATER }
internal enum class ThemeDownloadOutcome { COMPLETED, FAILED, DEFERRED, SKIPPED }

internal fun audioWarmupDecision(audioState: String): AudioWarmupDecision = when (audioState) {
    "READY" -> AudioWarmupDecision.READY
    "FAILED" -> AudioWarmupDecision.FAILED
    else -> AudioWarmupDecision.WAIT
}

internal fun downloadFailureStatus(runAttemptCount: Int, maxAttempts: Int = DOWNLOAD_MAX_ATTEMPTS): String =
    if (runAttemptCount + 1 >= maxAttempts) DownloadItemEntity.STATUS_FAILED else DownloadItemEntity.STATUS_RETRYING

internal fun downloadFileExtension(url: String, defaultExtension: String): String {
    val segment = url.toHttpUrlOrNull()?.encodedPathSegments?.lastOrNull()
        ?: url.substringBefore('?').substringAfterLast('/')
    return segment.substringAfterLast('.', "")
        .takeIf { it.length in 1..12 && it.all(Char::isLetterOrDigit) }
        ?: defaultExtension
}

internal fun audioExtensionForContentType(contentType: String?): String? = when (contentType?.substringBefore(';')?.lowercase()) {
    "audio/aac" -> "aac"
    "audio/flac", "audio/x-flac" -> "flac"
    "audio/mp4", "audio/x-m4a" -> "m4a"
    "audio/mpeg" -> "mp3"
    "audio/ogg" -> "ogg"
    "audio/opus" -> "opus"
    "audio/wav", "audio/x-wav" -> "wav"
    else -> null
}

internal suspend fun <T, R> mapWithDownloadParallelism(
    items: List<T>,
    parallelism: Int = DOWNLOAD_MAX_PARALLEL_TRANSFERS,
    block: suspend (T) -> R
): List<R> = items.chunked(parallelism.coerceIn(1, DOWNLOAD_MAX_PARALLEL_TRANSFERS)).flatMap { chunk ->
    coroutineScope { chunk.map { async { block(it) } }.awaitAll() }
}

private data class TransferResult(val file: File, val size: Long)
private class DownloadNoLongerEligibleException : Exception()

internal fun isDownloadStillEligible(item: DownloadItemEntity?): Boolean =
    item?.status == DownloadItemEntity.STATUS_DOWNLOADING

internal fun deleteUncommittedTransfer(file: File?) {
    file?.takeIf(File::exists)?.delete()
}

@HiltWorker
class DownloadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val downloadItemDao: DownloadItemDao,
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val musicCatalogDao: MusicCatalogDao,
    private val animeDao: AnimeDao,
    private val okHttpClient: OkHttpClient,
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore,
    private val serverTokenStore: ServerTokenStore,
    private val sessionStateManager: SessionStateManager
) : CoroutineWorker(appContext, workerParams) {
    companion object {
        private const val TAG = "DownloadWorker"
        const val UNIQUE_WORK_NAME = "download_batch"
        const val CHANNEL_ID = "downloads"
        const val NOTIFICATION_ID = 9003
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        createNotificationChannel()
        return ForegroundInfo(
            NOTIFICATION_ID,
            notification(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            setForeground(getForegroundInfo())
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Log.w(TAG, "Unable to enter foreground", error)
        }
        val processed = mutableSetOf<String>()
        var deferred = false
        try {
            while (true) {
                val batch = downloadItemDao.getNextBatch(processed.toList(), DOWNLOAD_MAX_PARALLEL_TRANSFERS)
                if (batch.isEmpty()) break
                processed += batch.map { it.mediaKey }
                mapWithDownloadParallelism(batch) { download(it) }.forEach {
                    if (it == ThemeDownloadOutcome.DEFERRED) deferred = true
                }
                showNotification()
            }
        } finally {
            if (downloadItemDao.getActiveCount() == 0) {
                applicationContext.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID)
            }
        }
        if (deferred && runAttemptCount < MAX_BATCH_ATTEMPTS - 1) Result.retry() else Result.success()
    }

    private suspend fun download(initial: DownloadItemEntity): ThemeDownloadOutcome {
        val item = downloadItemDao.get(initial.mediaKey) ?: return ThemeDownloadOutcome.SKIPPED
        if (item.status == DownloadItemEntity.STATUS_COMPLETED && item.filePath?.let(::File)?.isFile == true) {
            return ThemeDownloadOutcome.SKIPPED
        }
        val source = resolveSource(item) ?: run {
            downloadItemDao.markProblem(item.mediaKey, DownloadItemEntity.STATUS_FAILED, "Audio is unavailable")
            return ThemeDownloadOutcome.FAILED
        }
        downloadItemDao.updateStatus(item.mediaKey, DownloadItemEntity.STATUS_DOWNLOADING)
        if (item.itemType == DownloadMediaSpec.TYPE_THEME) {
            when (awaitServerAudioReady(item.itemId)) {
                ServerAudioReadiness.FAILED -> {
                    downloadItemDao.markProblem(item.mediaKey, DownloadItemEntity.STATUS_FAILED, "Server reported audio unavailable")
                    return ThemeDownloadOutcome.FAILED
                }
                ServerAudioReadiness.RETRY_LATER -> {
                    downloadItemDao.markProblem(item.mediaKey, DownloadItemEntity.STATUS_RETRYING, "Server audio not cached yet")
                    return ThemeDownloadOutcome.DEFERRED
                }
                ServerAudioReadiness.PROCEED -> Unit
            }
        }

        var lastError = "Audio download failed"
        repeat(DOWNLOAD_MAX_ATTEMPTS) { attempt ->
            var uncommittedTransfer: File? = null
            try {
                val transfer = downloadFile(source, item)
                uncommittedTransfer = transfer.file
                val image = if (item.itemType == DownloadMediaSpec.TYPE_THEME) downloadArtwork(item.itemId) else null
                if (!isDownloadStillEligible(downloadItemDao.get(item.mediaKey))) {
                    throw DownloadNoLongerEligibleException()
                }
                item.filePath?.takeIf { it != transfer.file.absolutePath }?.let(::File)?.takeIf(File::exists)?.delete()
                downloadItemDao.markCompleted(item.mediaKey, transfer.file.absolutePath, image, transfer.size)
                uncommittedTransfer = null
                if (item.itemType == DownloadMediaSpec.TYPE_THEME) updateLegacyTv(item.itemId, transfer.file)
                return ThemeDownloadOutcome.COMPLETED
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                deleteUncommittedTransfer(uncommittedTransfer)
                throw cancelled
            } catch (_: DownloadNoLongerEligibleException) {
                deleteUncommittedTransfer(uncommittedTransfer)
                return ThemeDownloadOutcome.SKIPPED
            } catch (error: Exception) {
                deleteUncommittedTransfer(uncommittedTransfer)
                lastError = error.message ?: "Audio download failed"
                Log.w(TAG, "Download ${item.mediaKey} attempt ${attempt + 1} failed", error)
                if (attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
                    downloadItemDao.markProblem(item.mediaKey, DownloadItemEntity.STATUS_RETRYING, lastError)
                    delay(2_000L * (attempt + 1))
                }
            }
        }
        downloadItemDao.markProblem(item.mediaKey, DownloadItemEntity.STATUS_FAILED, lastError)
        return ThemeDownloadOutcome.FAILED
    }

    private suspend fun resolveSource(item: DownloadItemEntity): String? {
        val raw = when (item.itemType) {
            DownloadMediaSpec.TYPE_THEME -> {
                themeModeDao.getByThemeIds(listOf(item.itemId)).firstOrNull()?.tvSizeUrl
                    ?: themeDao.getByIds(listOf(item.itemId)).firstOrNull()?.audioUrl
            }
            DownloadMediaSpec.TYPE_SONG -> musicCatalogDao.getSong(item.itemId)?.audioUrl
            else -> null
        }?.takeIf(String::isNotBlank) ?: return null
        return rebaseServerMediaUrl(serverSettingsStore.serverBaseUrl, raw)
    }

    private suspend fun downloadFile(url: String, item: DownloadItemEntity): TransferResult {
        val request = Request.Builder().url(url).apply {
            if (isServerUrl(serverSettingsStore.serverBaseUrl, url)) {
                serverMediaRequestHeaders(serverTokenStore.currentToken()).forEach { (name, value) -> header(name, value) }
            }
        }.build()
        okHttpClient.newCall(request).execute().use { response ->
            check(response.isSuccessful) { "HTTP ${response.code}" }
            val contentType = response.body?.contentType()?.toString()?.lowercase().orEmpty()
            check(!contentType.startsWith("video/")) { "Video cannot be downloaded" }
            val body = checkNotNull(response.body) { "Empty response" }
            val root = checkNotNull(
                canonicalDownloadItemDirectory(applicationContext.filesDir, item.itemType, item.itemId)
            ) { "Unsupported download item type" }
            root.mkdirs()
            val serverName = safeDownloadFileName(response.header("Content-Disposition"))
            val mimeExtension = audioExtensionForContentType(response.header("Content-Type"))
            val fallback = "original.${mimeExtension ?: downloadFileExtension(url, "ogg")}"
            val output = File(root, serverName ?: fallback)
            val temp = File(root, ".${output.name}.part")
            try {
                var written = 0L
                val total = body.contentLength()
                body.byteStream().use { input ->
                    FileOutputStream(temp).use { sink ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            sink.write(buffer, 0, count)
                            written += count
                            if (total > 0) {
                                downloadItemDao.updateProgress(
                                    item.mediaKey,
                                    DownloadItemEntity.STATUS_DOWNLOADING,
                                    ((written * 100L) / total).toInt()
                                )
                            }
                        }
                    }
                }
                check(written > 0) { "Empty response" }
                val current = downloadItemDao.get(item.mediaKey)
                if (!isDownloadStillEligible(current)) {
                    throw DownloadNoLongerEligibleException()
                }
                if (output.exists()) output.delete()
                check(temp.renameTo(output)) { "Could not finalize download" }
                return TransferResult(output, written)
            } finally {
                if (temp.exists()) temp.delete()
            }
        }
    }

    private suspend fun downloadArtwork(themeId: Long): String? {
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull() ?: return null
        val raw = theme.animeId?.let { animeDao.getByAnimeThemesIds(listOf(it)).firstOrNull()?.primaryArtworkUrl() }
            ?: return null
        val url = rebaseServerMediaUrl(serverSettingsStore.serverBaseUrl, raw)
        val request = Request.Builder().url(url).apply {
            if (isServerUrl(serverSettingsStore.serverBaseUrl, url)) {
                serverMediaRequestHeaders(serverTokenStore.currentToken()).forEach { (name, value) -> header(name, value) }
            }
        }.build()
        return runCatching {
            okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use null
                val body = response.body ?: return@use null
                val dir = File(applicationContext.filesDir, "downloads/images").apply { mkdirs() }
                val file = File(dir, "$themeId.${downloadFileExtension(url, "jpg")}")
                body.byteStream().use { input -> FileOutputStream(file).use(input::copyTo) }
                file.absolutePath
            }
        }.getOrNull()
    }

    private suspend fun updateLegacyTv(themeId: Long, file: File) {
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull() ?: return
        themeDao.upsertAll(listOf(theme.copy(isDownloaded = true, localFilePath = file.absolutePath)))
    }

    private suspend fun awaitServerAudioReady(themeId: Long): ServerAudioReadiness {
        if (!serverSettingsStore.isConfigured) return ServerAudioReadiness.PROCEED
        if (!sessionStateManager.isOnlineEnabled()) return ServerAudioReadiness.RETRY_LATER
        val deadline = SystemClock.elapsedRealtime() + MAX_WARMUP_WAIT_MS
        var wait = 1_000L
        while (true) {
            val state = runCatching { ongakuApi.requestAudio(themeId).audioState }
                .getOrElse { return ServerAudioReadiness.RETRY_LATER }
            when (audioWarmupDecision(state)) {
                AudioWarmupDecision.READY -> return ServerAudioReadiness.PROCEED
                AudioWarmupDecision.FAILED -> return ServerAudioReadiness.FAILED
                AudioWarmupDecision.WAIT -> if (SystemClock.elapsedRealtime() >= deadline) {
                    return ServerAudioReadiness.RETRY_LATER
                }
            }
            delay(wait)
            wait = (wait * 2).coerceAtMost(5_000L)
        }
    }

    private suspend fun notification(): android.app.Notification {
        val active = downloadItemDao.getActiveCount()
        return NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Downloading Music")
            .setContentText(if (active == 1) "Downloading 1 item" else "Downloading $active items")
            .setOngoing(true).setSilent(true).setProgress(0, 0, active > 0).build()
    }

    private suspend fun showNotification() {
        createNotificationChannel()
        applicationContext.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
    }

    private fun createNotificationChannel() {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Downloads", NotificationManager.IMPORTANCE_LOW))
    }
}
