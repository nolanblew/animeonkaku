package com.takeya.animeongaku.media

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

@Singleton
class PlaybackPreferences internal constructor(
    private val preferences: SharedPreferences
) {
    private val _showOstsOnHome = MutableStateFlow(preferences.getBoolean(KEY_SHOW_OSTS, true))
    val showOstsOnHomeFlow: StateFlow<Boolean> = _showOstsOnHome.asStateFlow()

    @Inject
    constructor(@ApplicationContext context: Context) : this(
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    )

    val rememberedAudioMode: PlaybackMode
        get() = preferences.getString(KEY_AUDIO_MODE, null)
            ?.let { stored -> PlaybackMode.entries.firstOrNull { it.name == stored } }
            ?.takeIf { it == PlaybackMode.TV_SIZE || it == PlaybackMode.FULL_SIZE }
            ?: PlaybackMode.TV_SIZE

    var showOstsOnHome: Boolean
        get() = _showOstsOnHome.value
        set(value) {
            preferences.edit().putBoolean(KEY_SHOW_OSTS, value).apply()
            _showOstsOnHome.value = value
        }

    internal fun rememberAudioMode(mode: PlaybackMode) {
        if (mode != PlaybackMode.TV_SIZE && mode != PlaybackMode.FULL_SIZE) return
        preferences.edit().putString(KEY_AUDIO_MODE, mode.name).apply()
    }

    private companion object {
        const val PREFS_NAME = "playback_preferences"
        const val KEY_AUDIO_MODE = "remembered_audio_mode"
        const val KEY_SHOW_OSTS = "show_osts_on_home"
    }
}
