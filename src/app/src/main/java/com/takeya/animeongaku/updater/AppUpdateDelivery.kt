package com.takeya.animeongaku.updater

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.Settings
import dagger.hilt.android.qualifiers.ApplicationContext
import java.net.URI
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val DOWNLOAD_PREFS_NAME = "app_update_downloads"
private const val KEY_DOWNLOAD_ID = "download_id"
private const val KEY_DOWNLOAD_TAG = "download_tag"
private const val KEY_DOWNLOAD_VERSION = "download_version"
private const val KEY_INSTALL_REQUESTED = "install_requested"
private const val KEY_INSTALL_ATTEMPTED = "install_attempted"
private const val KEY_WAITING_FOR_PERMISSION = "waiting_for_permission"
private const val APK_MIME_TYPE = "application/vnd.android.package-archive"

internal object AppUpdateForegroundState {
    @Volatile
    var isForeground: Boolean = false
}

enum class AppUpdateDownloadStatus {
    Idle,
    Queued,
    Downloading,
    Paused,
    Downloaded,
    Installing,
    AwaitingInstallPermission,
    Failed
}

data class AppUpdateDownloadState(
    val status: AppUpdateDownloadStatus = AppUpdateDownloadStatus.Idle,
    val downloadId: Long = -1L,
    val versionName: String? = null,
    val versionTag: String? = null,
    val progress: Int = 0,
    val message: String? = null
)

sealed interface UpdateDownloadResult {
    data class Started(val downloadId: Long) : UpdateDownloadResult
    data object AlreadyQueued : UpdateDownloadResult
    data object AlreadyDownloaded : UpdateDownloadResult
    data object InvalidRelease : UpdateDownloadResult
    data class Failed(val message: String) : UpdateDownloadResult
}

sealed interface UpdateInstallResult {
    data object Started : UpdateInstallResult
    data object RequiresInstallPermission : UpdateInstallResult
    data object AlreadyInstalling : UpdateInstallResult
    data object NoDownloadedUpdate : UpdateInstallResult
    data class Failed(val message: String) : UpdateInstallResult
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

internal fun updateDownloadProgress(bytesDownloaded: Long, bytesTotal: Long): Int =
    if (bytesTotal <= 0L) 0 else ((bytesDownloaded * 100L) / bytesTotal).toInt().coerceIn(0, 100)

internal fun appUpdateDownloadStatus(downloadManagerStatus: Int): AppUpdateDownloadStatus =
    when (downloadManagerStatus) {
        DownloadManager.STATUS_PENDING -> AppUpdateDownloadStatus.Queued
        DownloadManager.STATUS_RUNNING -> AppUpdateDownloadStatus.Downloading
        DownloadManager.STATUS_PAUSED -> AppUpdateDownloadStatus.Paused
        DownloadManager.STATUS_SUCCESSFUL -> AppUpdateDownloadStatus.Downloaded
        DownloadManager.STATUS_FAILED -> AppUpdateDownloadStatus.Failed
        else -> AppUpdateDownloadStatus.Failed
    }

internal fun shouldResumeInstall(
    status: AppUpdateDownloadStatus,
    canRequestPackageInstalls: Boolean,
    installRequested: Boolean,
    installAttempted: Boolean
): Boolean =
    (status == AppUpdateDownloadStatus.AwaitingInstallPermission && canRequestPackageInstalls) ||
        (status == AppUpdateDownloadStatus.Downloaded && installRequested && !installAttempted)

@Singleton
class AppUpdateInstaller @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val downloadManager: DownloadManager
        get() = context.getSystemService(DownloadManager::class.java)

    private val prefs by lazy {
        context.getSharedPreferences(DOWNLOAD_PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val _state = MutableStateFlow(AppUpdateDownloadState())
    val state: StateFlow<AppUpdateDownloadState> = _state.asStateFlow()

    fun enqueue(update: AvailableAppUpdate): UpdateDownloadResult {
        if (!isTrustedReleaseApkUrl(update.downloadUrl)) return UpdateDownloadResult.InvalidRelease

        val existingTag = prefs.getString(KEY_DOWNLOAD_TAG, null)
        val existingId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (existingTag == update.versionTag && existingId >= 0) {
            val existingState = refreshState()
            if (existingState.downloadId == existingId &&
                existingState.status != AppUpdateDownloadStatus.Failed &&
                existingState.status != AppUpdateDownloadStatus.Idle &&
                existingState.status != AppUpdateDownloadStatus.Paused
            ) {
                return if (existingState.status == AppUpdateDownloadStatus.Downloaded) {
                    UpdateDownloadResult.AlreadyDownloaded
                } else {
                    UpdateDownloadResult.AlreadyQueued
                }
            }
        }

        if (existingId >= 0L) {
            runCatching { downloadManager.remove(existingId) }
        }

        return runCatching {
            val request = DownloadManager.Request(Uri.parse(update.downloadUrl))
                .setTitle("Anime Ongaku ${update.versionName}")
                .setDescription("Downloading app update")
                .setMimeType(APK_MIME_TYPE)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(
                    context,
                    Environment.DIRECTORY_DOWNLOADS,
                    updateApkFileName("${update.versionTag}-${System.currentTimeMillis()}")
                )

            val downloadId = downloadManager.enqueue(request)
            prefs.edit()
                .putLong(KEY_DOWNLOAD_ID, downloadId)
                .putString(KEY_DOWNLOAD_TAG, update.versionTag)
                .putString(KEY_DOWNLOAD_VERSION, update.versionName)
                .putBoolean(KEY_INSTALL_REQUESTED, true)
                .putBoolean(KEY_INSTALL_ATTEMPTED, false)
                .putBoolean(KEY_WAITING_FOR_PERMISSION, false)
                .apply()
            refreshState()
            UpdateDownloadResult.Started(downloadId)
        }.getOrElse { error ->
            UpdateDownloadResult.Failed(
                error.message?.takeIf(String::isNotBlank) ?: "Unable to start the update download."
            )
        }
    }

    /** Reads the DownloadManager row again after a process or activity restart. */
    fun refreshState(): AppUpdateDownloadState {
        val downloadId = prefs.getLong(KEY_DOWNLOAD_ID, -1L)
        if (downloadId < 0L) return publish(AppUpdateDownloadState())

        val state = runCatching {
            downloadManager.query(DownloadManager.Query().setFilterById(downloadId))?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                val bytes = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                var mappedStatus = appUpdateDownloadStatus(status)
                val downloadedUri = if (mappedStatus == AppUpdateDownloadStatus.Downloaded) {
                    downloadManager.getUriForDownloadedFile(downloadId)
                } else null
                val downloadedFileReadable = downloadedUri?.let { uri ->
                    runCatching {
                        context.contentResolver.openFileDescriptor(uri, "r")?.use { true } == true
                    }.getOrDefault(false)
                } == true
                if (mappedStatus == AppUpdateDownloadStatus.Downloaded && !downloadedFileReadable) {
                    mappedStatus = AppUpdateDownloadStatus.Failed
                }
                if (mappedStatus == AppUpdateDownloadStatus.Downloaded &&
                    prefs.getBoolean(KEY_WAITING_FOR_PERMISSION, false) &&
                    !context.packageManager.canRequestPackageInstalls()
                ) {
                    mappedStatus = AppUpdateDownloadStatus.AwaitingInstallPermission
                }
                AppUpdateDownloadState(
                    status = mappedStatus,
                    downloadId = downloadId,
                    versionName = prefs.getString(KEY_DOWNLOAD_VERSION, null),
                    versionTag = prefs.getString(KEY_DOWNLOAD_TAG, null),
                    progress = if (mappedStatus == AppUpdateDownloadStatus.Downloaded) {
                        100
                    } else {
                        updateDownloadProgress(bytes, total)
                    },
                    message = when (mappedStatus) {
                        AppUpdateDownloadStatus.Failed -> if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            "The downloaded APK is no longer available."
                        } else {
                            "Download failed (code $reason)."
                        }
                        AppUpdateDownloadStatus.AwaitingInstallPermission ->
                            "Allow installs from Anime Ongaku in Android settings."
                        else -> null
                    }
                )
            }
        }.getOrNull() ?: AppUpdateDownloadState(
            status = AppUpdateDownloadStatus.Failed,
            downloadId = downloadId,
            versionName = prefs.getString(KEY_DOWNLOAD_VERSION, null),
            versionTag = prefs.getString(KEY_DOWNLOAD_TAG, null),
            message = "Unable to read the update download."
        )

        return publish(state)
    }

    fun installDownloadedUpdate(): UpdateInstallResult {
        val current = refreshState()
        if (current.status == AppUpdateDownloadStatus.Installing) return UpdateInstallResult.AlreadyInstalling
        if (current.status != AppUpdateDownloadStatus.Downloaded &&
            current.status != AppUpdateDownloadStatus.AwaitingInstallPermission
        ) return UpdateInstallResult.NoDownloadedUpdate

        if (!context.packageManager.canRequestPackageInstalls()) {
            prefs.edit().putBoolean(KEY_WAITING_FOR_PERMISSION, true).apply()
            publish(current.copy(status = AppUpdateDownloadStatus.AwaitingInstallPermission))
            return runCatching {
                context.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${context.packageName}")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                UpdateInstallResult.RequiresInstallPermission
            }.getOrElse { error ->
                UpdateInstallResult.Failed(
                    error.message?.takeIf(String::isNotBlank)
                        ?: "Allow installs from Anime Ongaku in Android settings."
                )
            }
        }

        val apkUri = downloadManager.getUriForDownloadedFile(current.downloadId)
            ?: return failInstall("The downloaded APK is no longer available.")

        return runCatching {
            prefs.edit()
                .putBoolean(KEY_INSTALL_ATTEMPTED, true)
                .putBoolean(KEY_WAITING_FOR_PERMISSION, false)
                .apply()
            context.startActivity(
                Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(apkUri, APK_MIME_TYPE)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    clipData = ClipData.newRawUri("Anime Ongaku update", apkUri)
                }
            )
            publish(current.copy(status = AppUpdateDownloadStatus.Installing, progress = 100))
            UpdateInstallResult.Started
        }.getOrElse { error ->
            failInstall(
                error.message?.takeIf(String::isNotBlank)
                    ?: "Unable to open the Android package installer."
            )
        }
    }

    /** Finishes a download/install flow interrupted by process or activity lifecycle changes. */
    fun resumeInstallIfNeeded(): UpdateInstallResult? {
        val current = refreshState()
        if (shouldResumeInstall(
                status = current.status,
                canRequestPackageInstalls = context.packageManager.canRequestPackageInstalls(),
                installRequested = prefs.getBoolean(KEY_INSTALL_REQUESTED, false),
                installAttempted = prefs.getBoolean(KEY_INSTALL_ATTEMPTED, false)
            )
        ) return installDownloadedUpdate()
        return null
    }

    private fun failInstall(message: String): UpdateInstallResult {
        publish(state.value.copy(status = AppUpdateDownloadStatus.Failed, message = message))
        return UpdateInstallResult.Failed(message)
    }

    private fun publish(value: AppUpdateDownloadState): AppUpdateDownloadState {
        _state.value = value
        return value
    }

    companion object {
        const val ACTION_INSTALL_UPDATE = "com.takeya.animeongaku.action.INSTALL_UPDATE"
        const val ACTION_DOWNLOAD_COMPLETE = DownloadManager.ACTION_DOWNLOAD_COMPLETE
        const val EXTRA_DOWNLOAD_ID = DownloadManager.EXTRA_DOWNLOAD_ID
        const val EXTRA_INSTALL_UPDATE = "install_update"
    }
}

/** Handles the system completion broadcast after validating it against our persisted row. */
internal fun processUpdateDownloadComplete(context: Context, intent: Intent) {
    val completedId = intent.getLongExtra(AppUpdateInstaller.EXTRA_DOWNLOAD_ID, -1L)
    val installer = AppUpdateInstaller(context)
    val state = installer.refreshState()
    if (completedId != state.downloadId) return
    if (state.status == AppUpdateDownloadStatus.Failed) {
        AppUpdateNotifier(context).notifyInstallFailed(
            state.message ?: "The update download failed."
        )
        return
    }
    when {
        state.status == AppUpdateDownloadStatus.Downloaded && AppUpdateForegroundState.isForeground -> {
            installer.resumeInstallIfNeeded()?.let { notifyUpdateInstallResult(context, it) }
        }
        state.status == AppUpdateDownloadStatus.Downloaded -> {
            AppUpdateNotifier(context).notifyUpdateDownloaded()
        }
        state.status == AppUpdateDownloadStatus.AwaitingInstallPermission -> {
            AppUpdateNotifier(context).notifyInstallPermissionRequired()
        }
    }
}

internal fun notifyUpdateInstallResult(context: Context, result: UpdateInstallResult) {
    val notifier = AppUpdateNotifier(context)
    when (result) {
        UpdateInstallResult.Started -> notifier.cancelAvailableUpdate()
        UpdateInstallResult.RequiresInstallPermission -> notifier.notifyInstallPermissionRequired()
        UpdateInstallResult.AlreadyInstalling -> Unit
        UpdateInstallResult.NoDownloadedUpdate -> notifier.notifyInstallFailed("The update download is not ready.")
        is UpdateInstallResult.Failed -> notifier.notifyInstallFailed(result.message)
    }
}

/** Receives DownloadManager's protected completion broadcast on Android 12+. */
class UpdateDownloadCompleteReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        val pendingResult = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                processUpdateDownloadComplete(appContext, intent)
            } finally {
                pendingResult.finish()
            }
        }
    }
}

class UpdateDownloadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val appContext = context.applicationContext
        val pendingResult = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                handleIntent(appContext, intent)
            } finally {
                pendingResult.finish()
            }
        }
    }

    private fun handleIntent(context: Context, intent: Intent) {
        val installer = AppUpdateInstaller(context)
        when (intent.action) {
            AppUpdateInstaller.ACTION_DOWNLOAD_COMPLETE -> {
                processUpdateDownloadComplete(context, intent)
            }
            AppUpdateInstaller.ACTION_INSTALL_UPDATE -> {
                notifyUpdateInstallResult(context, installer.installDownloadedUpdate())
            }
            else -> {
                val downloadUrl = intent.getStringExtra(EXTRA_DOWNLOAD_URL) ?: return
                val versionName = intent.getStringExtra(EXTRA_VERSION_NAME) ?: return
                val versionTag = intent.getStringExtra(EXTRA_VERSION_TAG) ?: return
                val releasePageUrl = intent.getStringExtra(EXTRA_RELEASE_PAGE_URL) ?: GITHUB_RELEASES_PAGE_URL
                val result = installer.enqueue(
                    AvailableAppUpdate(versionName, versionTag, downloadUrl, releasePageUrl)
                )
                if (result is UpdateDownloadResult.Started ||
                    result is UpdateDownloadResult.AlreadyQueued ||
                    result is UpdateDownloadResult.AlreadyDownloaded
                ) {
                    AppUpdateNotifier(context).cancelAvailableUpdate()
                    if (result is UpdateDownloadResult.AlreadyDownloaded) {
                        AppUpdateNotifier(context).notifyUpdateDownloaded()
                    }
                }
            }
        }
    }

    companion object {
        const val EXTRA_DOWNLOAD_URL = "download_url"
        const val EXTRA_VERSION_NAME = "version_name"
        const val EXTRA_VERSION_TAG = "version_tag"
        const val EXTRA_RELEASE_PAGE_URL = "release_page_url"
    }
}
