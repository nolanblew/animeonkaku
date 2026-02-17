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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class LibrarySyncService : Service() {

    companion object {
        private const val TAG = "LibrarySyncService"
        const val CHANNEL_ID = "library_sync"
        const val NOTIFICATION_ID = 9001
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_FORCE_FULL_SYNC = "force_full_sync"
        const val ACTION_PAUSE = "com.takeya.animeongaku.sync.PAUSE"
        const val ACTION_RESUME = "com.takeya.animeongaku.sync.RESUME"
        const val ACTION_STOP = "com.takeya.animeongaku.sync.STOP"

        fun start(context: Context, userId: String, forceFullSync: Boolean = false) {
            val intent = Intent(context, LibrarySyncService::class.java).apply {
                putExtra(EXTRA_USER_ID, userId)
                putExtra(EXTRA_FORCE_FULL_SYNC, forceFullSync)
            }
            context.startForegroundService(intent)
        }
    }

    @Inject lateinit var syncManager: SyncManager

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var observerJob: Job? = null
    private var syncStarted = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Preparing sync…", 0, 0, false))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> {
                syncManager.pause()
                return START_STICKY
            }
            ACTION_RESUME -> {
                syncManager.resume()
                return START_STICKY
            }
            ACTION_STOP -> {
                syncManager.cancel()
                stopSelf()
                return START_NOT_STICKY
            }
        }

        val userId = intent?.getStringExtra(EXTRA_USER_ID)
        val forceFullSync = intent?.getBooleanExtra(EXTRA_FORCE_FULL_SYNC, false) ?: false

        if (userId != null && !syncManager.isRunning) {
            syncManager.startSync(userId, forceFullSync)
        }

        observerJob?.cancel()
        observerJob = serviceScope.launch {
            syncManager.state.collect { state ->
                android.util.Log.d(TAG, "State: phase=${state.phase}, status=${state.status}, syncStarted=$syncStarted")

                // Track that we've seen a non-idle state
                if (state.phase != SyncPhase.Idle) {
                    syncStarted = true
                }

                // Ignore Idle emissions before sync has started (avoids race condition)
                if (state.phase == SyncPhase.Idle && !syncStarted) {
                    return@collect
                }

                val notification = when (state.phase) {
                    SyncPhase.Done -> {
                        buildCompletionNotification(state)
                    }
                    SyncPhase.Error -> {
                        buildNotification(
                            state.errorMessage ?: "Sync error",
                            0, 0, false
                        )
                    }
                    SyncPhase.Idle -> null
                    else -> {
                        val progress = computeProgress(state)
                        buildNotification(
                            state.status,
                            progress.first,
                            progress.second,
                            state.isPaused
                        )
                    }
                }

                if (notification != null) {
                    val nm = getSystemService(NotificationManager::class.java)
                    nm.notify(NOTIFICATION_ID, notification)
                }

                // Only stop the service after sync has actually started and reached a terminal state
                if (syncStarted && (state.phase == SyncPhase.Done || state.phase == SyncPhase.Error || state.phase == SyncPhase.Idle)) {
                    if (state.phase != SyncPhase.Idle) {
                        stopForeground(STOP_FOREGROUND_DETACH)
                    }
                    stopSelf()
                }
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        observerJob?.cancel()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Library Sync",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Shows progress while syncing your anime library"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(
        text: String,
        progress: Int,
        max: Int,
        isPaused: Boolean
    ): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                putExtra("navigate_to", "import")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Syncing Library")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)

        if (max > 0) {
            builder.setProgress(max, progress, false)
        } else {
            builder.setProgress(0, 0, true)
        }

        // Pause/Resume action
        if (isPaused) {
            val resumeIntent = PendingIntent.getService(
                this, 1,
                Intent(this, LibrarySyncService::class.java).apply { action = ACTION_RESUME },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Resume", resumeIntent)
        } else {
            val pauseIntent = PendingIntent.getService(
                this, 1,
                Intent(this, LibrarySyncService::class.java).apply { action = ACTION_PAUSE },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            builder.addAction(0, "Pause", pauseIntent)
        }

        // Stop action
        val stopIntent = PendingIntent.getService(
            this, 2,
            Intent(this, LibrarySyncService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        builder.addAction(0, "Stop", stopIntent)

        return builder.build()
    }

    private fun buildCompletionNotification(state: SyncState): Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                putExtra("navigate_to", "import")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val text = buildString {
            append("Imported ${state.lastSyncCount} anime, ${state.lastThemeCount} themes")
            if (state.unmatchedAnime.isNotEmpty()) {
                append(" · ${state.unmatchedAnime.size} unmatched")
            }
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Sync Complete")
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .build()
    }

    private fun computeProgress(state: SyncState): Pair<Int, Int> {
        return when (state.phase) {
            SyncPhase.SyncingLibrary -> {
                val lp = state.libraryProgress
                if (lp?.totalCount != null && lp.totalCount > 0) {
                    Pair(lp.fetchedCount, lp.totalCount)
                } else {
                    Pair(0, 0) // indeterminate
                }
            }
            SyncPhase.MappingThemes -> {
                val tp = state.themeProgress
                if (tp != null && tp.totalBatches > 0) {
                    Pair(tp.batchIndex, tp.totalBatches)
                } else {
                    Pair(0, 0)
                }
            }
            SyncPhase.FallbackSearch -> {
                if (state.fallbackTotal > 0) {
                    Pair(state.fallbackCurrent, state.fallbackTotal)
                } else {
                    Pair(0, 0)
                }
            }
            else -> Pair(0, 0)
        }
    }
}
