package com.takeya.animeongaku.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class StatusSyncService : Service() {

    companion object {
        private const val TAG = "StatusSyncService"
        const val NOTIFICATION_ID = 9002
        private const val TIMEOUT_MS = 60_000L

        fun start(context: Context) {
            val intent = Intent(context, StatusSyncService::class.java)
            context.startForegroundService(intent)
        }
    }

    @Inject lateinit var statusSyncManager: LibraryStatusSyncManager

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var timeoutJob: Job? = null
    private var syncStarted = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Updating library status…"))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (syncStarted) {
            // Already started sync from a previous onStartCommand — ignore duplicate starts
            return START_NOT_STICKY
        }

        if (!statusSyncManager.isRunning) {
            syncStarted = true

            // Safety timeout — if the sync hangs, stop the service anyway
            timeoutJob = serviceScope.launch {
                delay(TIMEOUT_MS)
                Log.w(TAG, "Status sync timed out after ${TIMEOUT_MS}ms, stopping service")
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }

            statusSyncManager.startSync(
                onComplete = { _ ->
                    timeoutJob?.cancel()
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            )
        } else {
            // Sync already running from another path — nothing we can do, just clean up
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        timeoutJob?.cancel()
        serviceScope.cancel()
        // Safety net: always ensure the notification is removed
        val nm = getSystemService(NotificationManager::class.java)
        nm.cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

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
}
