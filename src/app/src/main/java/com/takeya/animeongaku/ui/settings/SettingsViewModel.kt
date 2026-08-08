package com.takeya.animeongaku.ui.settings

import androidx.lifecycle.ViewModel
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.media.BluetoothMetadataStyle
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val downloadPreferences: DownloadPreferences,
    private val playbackPreferences: PlaybackPreferences
) : ViewModel() {

    private val _wifiOnly = MutableStateFlow(downloadPreferences.wifiOnly)
    val wifiOnly: StateFlow<Boolean> = _wifiOnly.asStateFlow()
    val showOstsOnHome: StateFlow<Boolean> = playbackPreferences.showOstsOnHomeFlow
    val bluetoothMetadataStyle: StateFlow<BluetoothMetadataStyle> =
        playbackPreferences.bluetoothMetadataStyleFlow

    fun setWifiOnly(enabled: Boolean) {
        downloadPreferences.wifiOnly = enabled
        _wifiOnly.value = enabled
    }

    fun setShowOstsOnHome(enabled: Boolean) {
        playbackPreferences.showOstsOnHome = enabled
    }

    fun setBluetoothMetadataStyle(style: BluetoothMetadataStyle) {
        playbackPreferences.bluetoothMetadataStyle = style
    }
}
