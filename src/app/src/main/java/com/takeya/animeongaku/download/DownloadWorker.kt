package com.takeya.animeongaku.download

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DownloadRequestEntity
import com.takeya.animeongaku.data.local.ThemeDao
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

@HiltWorker
class DownloadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val downloadDao: DownloadDao,
    private val themeDao: ThemeDao,
    private val okHttpClient: OkHttpClient
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "DownloadWorker"
        const val KEY_THEME_ID = "theme_id"
        const val KEY_AUDIO_URL = "audio_url"
        const val KEY_IMAGE_URL = "image_url"
        const val CHANNEL_ID = "downloads"
        const val NOTIFICATION_ID = 9002
        const val PROGRESS_KEY = "download_progress"
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        createNotificationChannel()
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Downloading Music")
            .setContentText("Preparing download…")
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .build()
        return ForegroundInfo(
            NOTIFICATION_ID,
            notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        )
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val themeId = inputData.getLong(KEY_THEME_ID, -1L)
        val audioUrl = inputData.getString(KEY_AUDIO_URL)
        val imageUrl = inputData.getString(KEY_IMAGE_URL)

        if (themeId == -1L || audioUrl.isNullOrBlank()) {
            Log.e(TAG, "Invalid input: themeId=$themeId, audioUrl=$audioUrl")
            return@withContext Result.failure()
        }

        Log.d(TAG, "Starting download for theme $themeId: $audioUrl")

        try {
            // Promote to foreground service with dataSync type
            setForeground(getForegroundInfo())

            downloadDao.updateStatus(themeId, DownloadRequestEntity.STATUS_DOWNLOADING)
            showNotification("Downloading…", -1)

            val downloadsDir = File(applicationContext.filesDir, "downloads")
            if (!downloadsDir.exists()) downloadsDir.mkdirs()

            // Download audio file
            val extension = audioUrl.substringAfterLast('.', "webm").substringBefore('?')
            val audioFile = File(downloadsDir, "${themeId}.$extension")
            val audioSize = downloadFile(audioUrl, audioFile, themeId)

            if (audioSize == -1L) {
                downloadDao.markFailed(themeId, "Audio download failed")
                return@withContext Result.retry()
            }

            // Download cover image if available
            var imagePath: String? = null
            if (!imageUrl.isNullOrBlank()) {
                val imagesDir = File(downloadsDir, "images")
                if (!imagesDir.exists()) imagesDir.mkdirs()
                val imageExtension = imageUrl.substringAfterLast('.', "jpg").substringBefore('?')
                val imageFile = File(imagesDir, "${themeId}.$imageExtension")
                val imageSize = downloadFile(imageUrl, imageFile, themeId, reportProgress = false)
                if (imageSize > 0) {
                    imagePath = imageFile.absolutePath
                }
            }

            // Mark as completed in DB
            downloadDao.markCompleted(
                themeId = themeId,
                filePath = audioFile.absolutePath,
                imagePath = imagePath,
                fileSize = audioSize
            )

            // Update the ThemeEntity to reflect downloaded status
            val theme = themeDao.getByIds(listOf(themeId)).firstOrNull()
            if (theme != null) {
                themeDao.upsertAll(listOf(theme.copy(
                    isDownloaded = true,
                    localFilePath = audioFile.absolutePath
                )))
            }

            cancelNotification()
            Log.d(TAG, "Download complete for theme $themeId: ${audioFile.absolutePath} ($audioSize bytes)")
            Result.success()

        } catch (e: kotlinx.coroutines.CancellationException) {
            Log.d(TAG, "Download cancelled for theme $themeId")
            cancelNotification()
            downloadDao.updateStatus(themeId, DownloadRequestEntity.STATUS_PAUSED)
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Download failed for theme $themeId", e)
            cancelNotification()
            downloadDao.markFailed(themeId, e.message ?: "Unknown error")
            Result.retry()
        }
    }

    private suspend fun downloadFile(
        url: String,
        outputFile: File,
        themeId: Long,
        reportProgress: Boolean = true
    ): Long {
        val request = Request.Builder().url(url).build()
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
                            setProgress(workDataOf(PROGRESS_KEY to progress))
                            showNotification("Downloading… $progress%", progress)
                        }
                    }
                }
            }
        }

        return downloadedBytes
    }

    private fun showNotification(text: String, progress: Int) {
        createNotificationChannel()

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

        if (progress in 0..100) {
            builder.setProgress(100, progress, false)
        } else {
            builder.setProgress(0, 0, true)
        }

        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, builder.build())
    }

    private fun cancelNotification() {
        val nm = applicationContext.getSystemService(NotificationManager::class.java)
        nm.cancel(NOTIFICATION_ID)
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
