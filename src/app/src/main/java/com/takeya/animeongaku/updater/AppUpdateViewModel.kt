package com.takeya.animeongaku.updater

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch

sealed interface AppUpdateEvent {
    data class OpenUrl(val url: String) : AppUpdateEvent
    data class ShowMessage(val message: String) : AppUpdateEvent
}

@HiltViewModel
class AppUpdateViewModel @Inject constructor(
    private val appUpdateManager: AppUpdateManager
) : ViewModel() {
    val state = appUpdateManager.state

    private val _events = MutableSharedFlow<AppUpdateEvent>(extraBufferCapacity = 1)
    val events: SharedFlow<AppUpdateEvent> = _events.asSharedFlow()

    init {
        viewModelScope.launch {
            appUpdateManager.refreshIfNeeded()
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
                        _events.emit(AppUpdateEvent.OpenUrl(result.update.downloadUrl))
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
        _events.tryEmit(AppUpdateEvent.OpenUrl(update.downloadUrl))
    }

    fun openReleasePage() {
        val url = state.value.availableUpdate?.releasePageUrl ?: GITHUB_RELEASES_PAGE_URL
        _events.tryEmit(AppUpdateEvent.OpenUrl(url))
    }
}
