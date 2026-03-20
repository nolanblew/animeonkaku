package com.takeya.animeongaku.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class StatusSyncService : Service() {

    companion object {
        private const val TAG = "StatusSyncService"
        const val NOTIFICATION_ID = 9002

        fun start(context: Context) {
            val intent = Intent(context, StatusSyncService::class.java)
            context.startForegroundService(intent)
        }
    }

    @Inject lateinit var statusSyncManager: LibraryStatusSyncManager

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Updating library status…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!statusSyncManager.isRunning) {
            statusSyncManager.startSync(
                onStart = {
                    // Update notification if needed
                },
                onComplete = { newAnimeCount ->
                    stopForeground(STOP_FOREGROUND_DETACH)
                    if (newAnimeCount > 0) {
                        // Optionally show a "done" notification
                        val nm = getSystemService(NotificationManager::class.java)
                        nm.notify(NOTIFICATION_ID, buildCompletionNotification(newAnimeCount))
                    } else {
                        // Just cancel the ongoing one
                        val nm = getSystemService(NotificationManager::class.java)
                        nm.cancel(NOTIFICATION_ID)
                    }
                    stopSelf()
                }
            )
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            LibrarySyncService.CHANNEL_ID,
            "Library Sync",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows progress while syncing your anime library"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, LibrarySyncService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Library Status")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(0, 0, true)
            .build()
    }

    private fun buildCompletionNotification(newAnimeCount: Int): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, LibrarySyncService.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Library Updated")
            .setContentText("Found $newAnimeCount new anime")
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .build()
    }
}
