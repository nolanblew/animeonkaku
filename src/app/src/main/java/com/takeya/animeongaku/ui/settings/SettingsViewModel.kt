package com.takeya.animeongaku.ui.settings

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.download.DownloadPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val downloadPreferences: DownloadPreferences,
    private val serverSettingsStore: ServerSettingsStore
) : ViewModel() {

    private val _wifiOnly = MutableStateFlow(downloadPreferences.wifiOnly)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()

    private val _serverBaseUrl = MutableStateFlow(serverSettingsStore.serverBaseUrl.orEmpty())
    val serverBaseUrl: StateFlow<String> = _serverBaseUrl.asStateFlow()

    val isServerBaseUrlCompiled: Boolean = serverSettingsStore.isServerBaseUrlCompiled

    fun setWifiOnly(enabled: Boolean) {
        downloadPreferences.wifiOnly = enabled
        _wifiOnly.value = enabled
    }

    fun setServerBaseUrl(value: String) {
        if (serverSettingsStore.isServerBaseUrlCompiled) {
            _serverBaseUrl.value = serverSettingsStore.serverBaseUrl.orEmpty()
            return
        }
        _serverBaseUrl.value = value
        serverSettingsStore.serverBaseUrl = value
    }
}
