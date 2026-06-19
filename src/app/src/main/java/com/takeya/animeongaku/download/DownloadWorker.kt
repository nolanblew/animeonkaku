package com.takeya.animeongaku.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.isServerUrl
import com.takeya.animeongaku.network.rebaseServerMediaUrl
import com.takeya.animeongaku.network.serverMediaRequestHeaders
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

internal const val DOWNLOAD_MAX_ATTEMPTS = 3

/** What to do next while waiting for the server to cache a track's audio. */
internal enum class AudioWarmupDecision { READY, FAILED, WAIT }

/** Outcome of waiting for the server-side cache before downloading. */
internal enum class ServerAudioReadiness { PROCEED, FAILED, RETRY_LATER }

/** Total in-worker budget spent polling the server cache before deferring to a later retry. */
private const val MAX_WARMUP_WAIT_MS = 45_000L
private const val INITIAL_WARMUP_POLL_MS = 1_000L
private const val MAX_WARMUP_POLL_MS = 5_000L

/** Backoff between in-worker download attempts for a single track. */
private const val DOWNLOAD_RETRY_BACKOFF_MS = 2_000L

/**
 * How many times the whole batch may be retried by WorkManager while tracks are still
 * deferred (e.g. server cache not warm yet). Caps exponential backoff so a permanently
 * unavailable track cannot keep the batch rescheduling forever.
 */
private const val MAX_BATCH_ATTEMPTS = 5

/** Outcome of attempting to download a single tracked theme. */
internal enum class ThemeDownloadOutcome { COMPLETED, FAILED, DEFERRED, SKIPPED }

/**
 * Maps a server-reported audio state to a warm-up action. Anything that is not a
 * terminal READY/FAILED keeps us waiting, so the client only ever downloads once the
 * server has the media locally — instead of racing the cache and forcing the server to
 * proxy AnimeThemes on every attempt. Unknown states wait (fail-safe) rather than
 * proceeding into a guaranteed origin hit.
 */
internal fun audioWarmupDecision(audioState: String): AudioWarmupDecision = when (audioState) {
    "READY" -> AudioWarmupDecision.READY
    "FAILED" -> AudioWarmupDecision.FAILED
    else -> AudioWarmupDecision.WAIT
}

internal fun downloadFailureStatus(
    runAttemptCount: Int,
    maxAttempts: Int = DOWNLOAD_MAX_ATTEMPTS
): String =
    if (runAttemptCount + 1 >= maxAttempts) {
        DownloadRequestEntity.STATUS_FAILED
    } else {
        DownloadRequestEntity.STATUS_RETRYING
    }

internal fun downloadFileExtension(url: String, defaultExtension: String): String {
    val pathSegment = url.toHttpUrlOrNull()
        ?.encodedPathSegments
        ?.lastOrNull()
        ?.takeIf { it.contains('.') }
        ?: url.substringBefore('?').substringAfterLast('/').takeIf { it.contains('.') }

    return pathSegment
        ?.substringAfterLast('.')
        ?.takeIf { extension -> extension.length in 1..12 && extension.all { it.isLetterOrDigit() } }
        ?: defaultExtension
}

/**
 * Single foreground worker that drains the entire download queue.
 *
 * Earlier this enqueued one foreground worker per track. Many short-lived foreground workers
 * sharing one [androidx.work.impl.foreground.SystemForegroundService] churned the foreground
 * service start/stop cycle; a start from one worker could race the teardown of another and the
 * framework killed the app with [android.app.RemoteServiceException.ForegroundServiceDidNotStartInTimeException].
 * A single batch worker means exactly one foreground-service lifecycle per batch, eliminating
 * that race. All per-track state lives in [DownloadDao], which the UI observes directly.
 */
@HiltWorker
class DownloadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val downloadDao: DownloadDao,
    private val themeDao: ThemeDao,
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
        val totalCount = downloadDao.getActiveBatchTotalCount()
        val completedCount = downloadDao.getActiveBatchCompletedCount()

        val text = if (totalCount <= 1) "Preparing download…"
                   else "Downloading ${completedCount + 1} of $totalCount songs"

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Downloading Music")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(
                if (totalCount > 1) totalCount else 0,
                if (totalCount > 1) completedCount else 0,
                totalCount <= 1
            )
            .build()
        return ForegroundInfo(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        // One foreground-service lifecycle for the whole batch. Best-effort: if the app is
        // backgrounded and promotion is disallowed, keep downloading without foreground rather
        // than failing the batch.
        setForegroundSafely()

        // Themes attempted in this pass so a track that fails or defers does not loop forever.
        val processed = mutableSetOf<Long>()
        var deferredAny = false

        try {
            while (true) {
                val next = downloadDao.getNextDownloadable(processed.toList()) ?: break
                processed += next.themeId
                when (downloadTheme(next.themeId)) {
                    ThemeDownloadOutcome.DEFERRED -> deferredAny = true
                    ThemeDownloadOutcome.COMPLETED,
                    ThemeDownloadOutcome.FAILED,
                    ThemeDownloadOutcome.SKIPPED -> Unit
                }
                showAggregateNotification()
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Pause/cancel/remove flows update DB status themselves; just release the
            // notification since this single worker owns it.
            applicationContext.getSystemService(NotificationManager::class.java)
                .cancel(NOTIFICATION_ID)
            throw e
        }

        cancelNotification()

        // Reschedule (with WorkManager backoff) only while tracks are still waiting on the
        // server cache, and only up to the attempt cap.
        if (deferredAny && runAttemptCount < MAX_BATCH_ATTEMPTS - 1) {
            Result.retry()
        } else {
            Result.success()
        }
    }

    /**
     * Downloads a single tracked theme, resolving its media/artwork URLs from the database and
     * rebasing them onto the live server host (a stale host — e.g. after a server URL change —
     * would otherwise download against a dead address forever). Retries transient failures
     * in-line; returns [ThemeDownloadOutcome.DEFERRED] when the server has not cached the audio
     * yet so the batch can retry later.
     */
    private suspend fun downloadTheme(themeId: Long): ThemeDownloadOutcome {
        val request = downloadDao.getDownloadForTheme(themeId)
        // Row removed (cancelled) or already finished while we were draining — nothing to do.
        if (request == null || request.status == DownloadRequestEntity.STATUS_COMPLETED) {
            return ThemeDownloadOutcome.SKIPPED
        }

        val serverBaseUrl = serverSettingsStore.serverBaseUrl
        val theme = themeDao.getByIds(listOf(themeId)).firstOrNull()
        val audioUrl = theme?.audioUrl?.let { rebaseServerMediaUrl(serverBaseUrl, it) }
        if (theme == null || audioUrl.isNullOrBlank()) {
            Log.e(TAG, "Missing audio URL for theme $themeId")
            downloadDao.markFailed(themeId, "Missing audio URL")
            return ThemeDownloadOutcome.FAILED
        }

        Log.d(TAG, "Starting download for theme $themeId: $audioUrl")
        downloadDao.updateStatus(themeId, DownloadRequestEntity.STATUS_DOWNLOADING)
        showAggregateNotification()

        when (awaitServerAudioReady(themeId)) {
            ServerAudioReadiness.PROCEED -> Unit
            ServerAudioReadiness.FAILED -> {
                downloadDao.markFailed(themeId, "Server reported audio unavailable")
                return ThemeDownloadOutcome.FAILED
            }
            ServerAudioReadiness.RETRY_LATER -> {
                downloadDao.markRetrying(themeId, "Server audio not cached yet")
                return ThemeDownloadOutcome.DEFERRED
            }
        }

        val downloadsDir = File(applicationContext.filesDir, "downloads")
        if (!downloadsDir.exists()) downloadsDir.mkdirs()
        val extension = downloadFileExtension(audioUrl, defaultExtension = "ogg")
        val audioFile = File(downloadsDir, "${themeId}.$extension")

        var lastError = "Audio download failed"
        repeat(DOWNLOAD_MAX_ATTEMPTS) { attempt ->
            try {
                val audioSize = downloadFile(audioUrl, audioFile, themeId)
                if (audioSize > 0) {
                    val imagePath = downloadArtwork(theme, downloadsDir, serverBaseUrl, themeId)
                    downloadDao.markCompleted(
                        themeId = themeId,
                        filePath = audioFile.absolutePath,
                        imagePath = imagePath,
                        fileSize = audioSize
                    )
                    themeDao.getByIds(listOf(themeId)).firstOrNull()?.let { current ->
                        themeDao.upsertAll(listOf(current.copy(
                            isDownloaded = true,
                            localFilePath = audioFile.absolutePath
                        )))
                    }
                    Log.d(TAG, "Download complete for theme $themeId: ${audioFile.absolutePath} ($audioSize bytes)")
                    return ThemeDownloadOutcome.COMPLETED
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                lastError = e.message ?: "Unknown error"
                Log.w(TAG, "Attempt ${attempt + 1} failed for theme $themeId", e)
            }
            if (attempt < DOWNLOAD_MAX_ATTEMPTS - 1) {
                downloadDao.markRetrying(themeId, lastError)
                delay(DOWNLOAD_RETRY_BACKOFF_MS * (attempt + 1))
            }
        }

        Log.e(TAG, "Download failed for theme $themeId after $DOWNLOAD_MAX_ATTEMPTS attempts")
        downloadDao.markFailed(themeId, lastError)
        return ThemeDownloadOutcome.FAILED
    }

    /** Downloads the cover image for [theme], returning the saved path or null. */
    private suspend fun downloadArtwork(
        theme: com.takeya.animeongaku.data.local.ThemeEntity,
        downloadsDir: File,
        serverBaseUrl: String?,
        themeId: Long
    ): String? {
        val imageUrl = theme.animeId
            ?.let { animeId -> animeDao.getByAnimeThemesIds(listOf(animeId)).firstOrNull()?.primaryArtworkUrl() }
            ?.let { rebaseServerMediaUrl(serverBaseUrl, it) }
        if (imageUrl.isNullOrBlank()) return null

        val imagesDir = File(downloadsDir, "images")
        if (!imagesDir.exists()) imagesDir.mkdirs()
        val imageExtension = downloadFileExtension(imageUrl, defaultExtension = "jpg")
        val imageFile = File(imagesDir, "${themeId}.$imageExtension")
        val imageSize = downloadFile(imageUrl, imageFile, themeId, reportProgress = false)
        return if (imageSize > 0) imageFile.absolutePath else null
    }

    private suspend fun setForegroundSafely() {
        try {
            setForeground(getForegroundInfo())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Unable to enter foreground; continuing in background", e)
        }
    }

    /**
     * Wait for the server to cache the track locally before downloading it. The server
     * only fetches from AnimeThemes on a cache miss, so by polling until the audio is
     * READY we guarantee the subsequent download is served from the server's local cache
     * (the origin is hit at most once, by the server's background fetch) instead of
     * forcing a slow/blocked AnimeThemes proxy on every download attempt.
     */
    private suspend fun awaitServerAudioReady(themeId: Long): ServerAudioReadiness {
        if (!serverSettingsStore.isConfigured) return ServerAudioReadiness.PROCEED
        if (!sessionStateManager.isOnlineEnabled()) return ServerAudioReadiness.RETRY_LATER
        val deadline = SystemClock.elapsedRealtime() + MAX_WARMUP_WAIT_MS
        var pollDelayMs = INITIAL_WARMUP_POLL_MS
        while (true) {
            val state = try {
                ongakuApi.requestAudio(themeId).audioState
            } catch (e: Exception) {
                Log.w(TAG, "Server audio warm-up failed for theme $themeId", e)
                return ServerAudioReadiness.RETRY_LATER
            }
            when (audioWarmupDecision(state)) {
                AudioWarmupDecision.READY -> return ServerAudioReadiness.PROCEED
                AudioWarmupDecision.FAILED -> return ServerAudioReadiness.FAILED
                AudioWarmupDecision.WAIT -> {
                    if (SystemClock.elapsedRealtime() >= deadline) {
                        Log.d(TAG, "Theme $themeId still $state after warm-up window; retrying later")
                        return ServerAudioReadiness.RETRY_LATER
                    }
                    delay(pollDelayMs)
                    pollDelayMs = (pollDelayMs * 2).coerceAtMost(MAX_WARMUP_POLL_MS)
                }
            }
        }
    }

    private suspend fun downloadFile(
        url: String,
        outputFile: File,
        themeId: Long,
        reportProgress: Boolean = true
    ): Long {
        val requestBuilder = Request.Builder().url(url)
        if (isServerUrl(serverSettingsStore.serverBaseUrl, url)) {
            serverMediaRequestHeaders(serverTokenStore.currentToken()).forEach { (name, value) ->
                requestBuilder.header(name, value)
            }
        }
        val request = requestBuilder.build()
        val response = okHttpClient.newCall(request).execute()

        if (!response.isSuccessful) {
            Log.e(TAG, "HTTP ${response.code} for $url")
            response.close()
            return -1L
        }

        val body = response.body ?: run {
            response.close()
            return -1L
        }

        val totalBytes = body.contentLength()
        var downloadedBytes = 0L

        body.byteStream().use { input ->
            FileOutputStream(outputFile).use { output ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                var lastProgressReport = 0

                while (input.read(buffer).also { bytesRead = it } != -1) {
                    output.write(buffer, 0, bytesRead)
                    downloadedBytes += bytesRead

                    if (reportProgress && totalBytes > 0) {
                        val progress = ((downloadedBytes * 100) / totalBytes).toInt()
                        if (progress > lastProgressReport + 4) {
                            lastProgressReport = progress
                            downloadDao.updateProgress(
                                themeId,
                                DownloadRequestEntity.STATUS_DOWNLOADING,
                                progress
                            )
                            showAggregateNotification()
                        }
                    }
                }
            }
        }

        return downloadedBytes
    }

    private suspend fun showAggregateNotification() {
        createNotificationChannel()

        val totalCount = downloadDao.getActiveBatchTotalCount()
        val completedCount = downloadDao.getActiveBatchCompletedCount()

        val text = if (totalCount <= 1) "Downloading…"
                   else "Downloading ${completedCount + 1} of $totalCount songs"

        val contentIntent = PendingIntent.getActivity(
            applicationContext, 0,
            Intent(applicationContext, MainActivity::class.java).apply {
                putExtra("navigate_to", "downloadManager")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Downloading Music")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)

        if (totalCount > 1) {
            builder.setProgress(totalCount, completedCount, false)
        } else {
            builder.setProgress(0, 0, true)
        }

        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, builder.build())
    }

    private suspend fun cancelNotification() {
        val remaining = downloadDao.getActiveDownloadCount()
        if (remaining == 0) {
            val nm = applicationContext.getSystemService(NotificationManager::class.java)
            nm.cancel(NOTIFICATION_ID)
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Downloads",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows progress while downloading music"
            setShowBadge(false)
        }
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }
}
