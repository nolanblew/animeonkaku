package com.takeya.animeongaku.ui.settings

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.work.LibraryPullScheduler
import com.takeya.animeongaku.work.PendingWritesScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val downloadPreferences: DownloadPreferences,
    private val serverSettingsStore: ServerSettingsStore,
    private val libraryPullScheduler: LibraryPullScheduler,
    private val pendingWritesScheduler: PendingWritesScheduler
) : ViewModel() {

    private val _wifiOnly = MutableStateFlow(downloadPreferences.wifiOnly)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()

    private val _serverBaseUrl = MutableStateFlow(serverSettingsStore.serverBaseUrl.orEmpty())
    val serverBaseUrl: StateFlow<String> = _serverBaseUrl.asStateFlow()

    val isServerBaseUrlCompiled: Boolean = serverSettingsStore.isServerBaseUrlCompiled
    val compiledServerBaseUrl: String = serverSettingsStore.compiledServerBaseUrl.orEmpty()

    fun setWifiOnly(enabled: Boolean) {
        downloadPreferences.wifiOnly = enabled
        _wifiOnly.value = enabled
    }

    fun setServerBaseUrl(value: String) {
        _serverBaseUrl.value = value
        serverSettingsStore.serverBaseUrl = value
        pendingWritesScheduler.schedule()
        libraryPullScheduler.schedule()
        pendingWritesScheduler.scheduleNow()
        libraryPullScheduler.scheduleNow()
    }
}
