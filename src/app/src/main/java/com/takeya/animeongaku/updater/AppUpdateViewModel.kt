package com.takeya.animeongaku.updater

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

sealed interface AppUpdateEvent {
    data class OpenUrl(val url: String) : AppUpdateEvent
    data class ShowMessage(val message: String) : AppUpdateEvent
}

@HiltViewModel
class AppUpdateViewModel @Inject constructor(
    private val appUpdateManager: AppUpdateManager,
    private val appUpdateInstaller: AppUpdateInstaller
) : ViewModel() {
    val state = appUpdateManager.state
    val downloadState = appUpdateInstaller.state

    private val _events = MutableSharedFlow<AppUpdateEvent>(extraBufferCapacity = 1)
    val events: SharedFlow<AppUpdateEvent> = _events.asSharedFlow()
    private var isResumed = false
    private var downloadRefreshJob: Job? = null

    init {
        viewModelScope.launch {
            appUpdateInstaller.refreshState()
            appUpdateManager.refreshIfNeeded()
        }
    }

    fun onResume() {
        isResumed = true
        downloadRefreshJob?.cancel()
        downloadRefreshJob = viewModelScope.launch {
            while (isActive && isResumed) {
                appUpdateInstaller.refreshState()
                delay(1_000L)
            }
        }
        viewModelScope.launch {
            when (val result = appUpdateInstaller.resumeInstallIfNeeded()) {
                UpdateInstallResult.RequiresInstallPermission -> {
                    _events.emit(AppUpdateEvent.ShowMessage("Allow installs from Anime Ongaku, then return here to continue."))
                }
                is UpdateInstallResult.Failed -> _events.emit(AppUpdateEvent.ShowMessage(result.message))
                else -> Unit
            }
        }
    }

    fun onPause() {
        isResumed = false
        downloadRefreshJob?.cancel()
        downloadRefreshJob = null
    }

    fun installDownloadedUpdate() {
        viewModelScope.launch {
            when (val result = appUpdateInstaller.installDownloadedUpdate()) {
                UpdateInstallResult.RequiresInstallPermission -> {
                    _events.emit(AppUpdateEvent.ShowMessage("Allow installs from Anime Ongaku, then return here to continue."))
                }
                is UpdateInstallResult.Failed -> _events.emit(AppUpdateEvent.ShowMessage(result.message))
                UpdateInstallResult.NoDownloadedUpdate -> {
                    state.value.availableUpdate?.let(::downloadUpdate)
                        ?: _events.emit(AppUpdateEvent.ShowMessage("The update download is not ready."))
                }
                else -> Unit
            }
        }
    }

    fun checkForUpdates(openWhenAvailable: Boolean = false) {
        if (state.value.isChecking) return

        viewModelScope.launch {
            when (val result = appUpdateManager.checkForUpdates()) {
                UpdateCheckResult.Disabled -> {
                    _events.emit(AppUpdateEvent.ShowMessage("Updates are only available in release builds."))
                }

                UpdateCheckResult.NoUpdate -> {
                    _events.emit(AppUpdateEvent.ShowMessage("You're already on the latest version."))
                }

                is UpdateCheckResult.UpdateAvailable -> {
                    if (openWhenAvailable) {
                        downloadUpdate(result.update)
                    } else {
                        _events.emit(
                            AppUpdateEvent.ShowMessage("Version ${result.update.versionName} is available.")
                        )
                    }
                }

                is UpdateCheckResult.Failed -> {
                    _events.emit(AppUpdateEvent.ShowMessage(result.message))
                }
            }
        }
    }

    fun openAvailableUpdate() {
        val update = state.value.availableUpdate ?: return
        downloadUpdate(update)
    }

    fun openReleasePage() {
        val url = state.value.availableUpdate?.releasePageUrl ?: GITHUB_RELEASES_PAGE_URL
        _events.tryEmit(AppUpdateEvent.OpenUrl(url))
    }

    private fun downloadUpdate(update: AvailableAppUpdate) {
        val existing = appUpdateInstaller.refreshState()
        val result = if (existing.versionTag == update.versionTag &&
            (existing.status == AppUpdateDownloadStatus.Downloaded ||
                existing.status == AppUpdateDownloadStatus.AwaitingInstallPermission)
        ) {
            appUpdateInstaller.installDownloadedUpdate()
        } else {
            appUpdateInstaller.enqueue(update)
        }
        val message = when (result) {
            is UpdateDownloadResult.Started -> "Downloading Anime Ongaku ${update.versionName}."
            UpdateDownloadResult.AlreadyQueued -> "This update is already in Downloads."
            UpdateDownloadResult.AlreadyDownloaded -> "The update is ready to install."
            UpdateDownloadResult.InvalidRelease -> "The GitHub release does not contain a trusted APK."
            is UpdateDownloadResult.Failed -> result.message
            UpdateInstallResult.Started -> "Opening the Android installer."
            UpdateInstallResult.RequiresInstallPermission -> "Allow installs from Anime Ongaku, then return here to continue."
            UpdateInstallResult.AlreadyInstalling -> "The Android installer is already open."
            UpdateInstallResult.NoDownloadedUpdate -> "The update download is not ready."
            is UpdateInstallResult.Failed -> result.message
            else -> "Update request could not be started."
        }
        _events.tryEmit(AppUpdateEvent.ShowMessage(message))
    }
}
