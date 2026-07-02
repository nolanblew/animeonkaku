package com.takeya.animeongaku.ui.settings

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.download.DownloadPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val downloadPreferences: DownloadPreferences
) : ViewModel() {

    private val _wifiOnly = MutableStateFlow(downloadPreferences.wifiOnly)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()

    fun setWifiOnly(enabled: Boolean) {
        downloadPreferences.wifiOnly = enabled
        _wifiOnly.value = enabled
    }
}
