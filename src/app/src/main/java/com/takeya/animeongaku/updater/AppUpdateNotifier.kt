package com.takeya.animeongaku.updater

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.takeya.animeongaku.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

private const val NOTIFICATION_PREFS_NAME = "app_update_notifications"
private const val KEY_LAST_NOTIFIED_TAG = "last_notified_tag"
private const val KEY_PERMISSION_REQUESTED = "notification_permission_requested"
private const val UPDATE_CHANNEL_ID = "app_updates"
private const val UPDATE_NOTIFICATION_ID = 2042

@Singleton
class AppUpdateNotifier @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val notificationManager: NotificationManager
        get() = context.getSystemService(NotificationManager::class.java)

    private val prefs by lazy {
        context.getSharedPreferences(NOTIFICATION_PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun notifyIfNew(update: AvailableAppUpdate): Boolean {
        if (!canPostNotifications()) return false
        if (!shouldNotifyUpdate(prefs.getString(KEY_LAST_NOTIFIED_TAG, null), update.versionTag)) return false

        createChannel()
        val releaseIntent = PendingIntent.getActivity(
            context,
            update.versionTag.hashCode(),
            Intent(Intent.ACTION_VIEW, Uri.parse(update.releasePageUrl)),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val downloadIntent = PendingIntent.getBroadcast(
            context,
            update.versionTag.hashCode(),
            Intent(context, UpdateDownloadReceiver::class.java).apply {
                putExtra(UpdateDownloadReceiver.EXTRA_DOWNLOAD_URL, update.downloadUrl)
                putExtra(UpdateDownloadReceiver.EXTRA_VERSION_NAME, update.versionName)
                putExtra(UpdateDownloadReceiver.EXTRA_VERSION_TAG, update.versionTag)
                putExtra(UpdateDownloadReceiver.EXTRA_RELEASE_PAGE_URL, update.releasePageUrl)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notes = update.releaseNotes?.trim()?.take(500)
        val notification = NotificationCompat.Builder(context, UPDATE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Anime Ongaku update available")
            .setContentText("Version ${update.versionName} is ready to download.")
            .setStyle(notes?.let { NotificationCompat.BigTextStyle().bigText(it) })
            .setContentIntent(releaseIntent)
            .addAction(0, "Download", downloadIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        notificationManager.notify(UPDATE_NOTIFICATION_ID, notification)
        prefs.edit().putString(KEY_LAST_NOTIFIED_TAG, update.versionTag).apply()
        return true
    }

    fun cancelAvailableUpdate() {
        notificationManager.cancel(UPDATE_NOTIFICATION_ID)
    }

    fun needsNotificationPermissionRequest(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !prefs.getBoolean(KEY_PERMISSION_REQUESTED, false)

    fun markNotificationPermissionRequested() {
        prefs.edit().putBoolean(KEY_PERMISSION_REQUESTED, true).apply()
    }

    private fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun createChannel() {
        notificationManager.createNotificationChannel(
            NotificationChannel(
                UPDATE_CHANNEL_ID,
                "App updates",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "New Anime Ongaku releases"
            }
        )
    }
}
