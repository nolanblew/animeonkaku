package com.takeya.animeongaku.updater

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import dagger.hilt.android.qualifiers.ApplicationContext
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton

private const val DOWNLOAD_PREFS_NAME = "app_update_downloads"
private const val KEY_DOWNLOAD_ID = "download_id"
private const val KEY_DOWNLOAD_TAG = "download_tag"

sealed interface UpdateDownloadResult {
    data class Started(val downloadId: Long) : UpdateDownloadResult
    data object AlreadyQueued : UpdateDownloadResult
    data object InvalidRelease : UpdateDownloadResult
    data class Failed(val message: String) : UpdateDownloadResult
}

internal fun isTrustedReleaseApkUrl(rawUrl: String): Boolean {
    val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
    val path = uri.path.orEmpty()
    return uri.scheme.equals("https", ignoreCase = true) &&
        uri.host.equals("github.com", ignoreCase = true) &&
        path.startsWith("/nolanblew/animeonkaku/releases/download/", ignoreCase = true) &&
        path.endsWith(".apk", ignoreCase = true)
}

internal fun shouldNotifyUpdate(lastNotifiedTag: String?, candidateTag: String): Boolean =
    candidateTag.isNotBlank() && candidateTag != lastNotifiedTag

internal fun updateApkFileName(versionTag: String): String {
    val safeTag = versionTag.trim()
        .replace(Regex("[^0-9A-Za-z._-]+"), "-")
        .trim('-', '.', '_')
        .ifBlank { "update" }
    return "anime-ongaku-$safeTag.apk"
}

@Singleton
class AppUpdateInstaller @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val downloadManager: DownloadManager
        get() = context.getSystemService(DownloadManager::class.java)

    private val prefs by lazy {
        context.getSharedPreferences(DOWNLOAD_PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun enqueue(update: AvailableAppUpdate): UpdateDownloadResult {
        if (!isTrustedReleaseApkUrl(update.downloadUrl)) {
            return UpdateDownloadResult.InvalidRelease
        }

        val existingTag = prefs.getString(KEY_DOWNLOAD_TAG, null)
        val existingId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (existingTag == update.versionTag && existingId >= 0 && isDownloadRetained(existingId)) {
            return UpdateDownloadResult.AlreadyQueued
        }

        return runCatching {
            val request = DownloadManager.Request(Uri.parse(update.downloadUrl))
                .setTitle("Anime Ongaku ${update.versionName}")
                .setDescription("Downloading app update")
                .setMimeType("application/vnd.android.package-archive")
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS,
                    updateApkFileName(update.versionTag)
                )

            val downloadId = downloadManager.enqueue(request)
            prefs.edit()
                .putLong(KEY_DOWNLOAD_ID, downloadId)
                .putString(KEY_DOWNLOAD_TAG, update.versionTag)
                .apply()
            UpdateDownloadResult.Started(downloadId)
        }.getOrElse { error ->
            UpdateDownloadResult.Failed(
                error.message?.takeIf(String::isNotBlank) ?: "Unable to start the update download."
            )
        }
    }

    private fun isDownloadRetained(downloadId: Long): Boolean {
        val query = DownloadManager.Query().setFilterById(downloadId)
        return runCatching {
            downloadManager.query(query)?.use { cursor ->
                if (!cursor.moveToFirst()) return@use false
                val statusColumn = cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
                cursor.getInt(statusColumn) != DownloadManager.STATUS_FAILED
            } ?: false
        }.getOrDefault(false)
    }
}

class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val downloadUrl = intent.getStringExtra(EXTRA_DOWNLOAD_URL) ?: return
        val versionName = intent.getStringExtra(EXTRA_VERSION_NAME) ?: return
        val versionTag = intent.getStringExtra(EXTRA_VERSION_TAG) ?: return
        val releasePageUrl = intent.getStringExtra(EXTRA_RELEASE_PAGE_URL) ?: GITHUB_RELEASES_PAGE_URL

        val result = AppUpdateInstaller(context.applicationContext).enqueue(
            AvailableAppUpdate(
                versionName = versionName,
                versionTag = versionTag,
                downloadUrl = downloadUrl,
                releasePageUrl = releasePageUrl
            )
        )
        if (result is UpdateDownloadResult.Started || result is UpdateDownloadResult.AlreadyQueued) {
            AppUpdateNotifier(context.applicationContext).cancelAvailableUpdate()
        }
    }

    companion object {
        const val EXTRA_DOWNLOAD_URL = "download_url"
        const val EXTRA_VERSION_NAME = "version_name"
        const val EXTRA_VERSION_TAG = "version_tag"
        const val EXTRA_RELEASE_PAGE_URL = "release_page_url"
    }
}
