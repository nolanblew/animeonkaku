package com.takeya.animeongaku.download

import android.content.Context
import android.content.SharedPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DownloadPreferences @Inject constructor(
    @ApplicationContext context: Context
) {
    companion object {
        private const val PREFS_NAME = "download_prefs"
        private const val KEY_WIFI_ONLY = "wifi_only"
        private const val KEY_LAST_RETRY_CHECK = "last_retry_check_at"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var wifiOnly: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY, true)
        set(value) = prefs.edit().putBoolean(KEY_WIFI_ONLY, value).apply()

    var lastRetryCheckAt: Long
        get() = prefs.getLong(KEY_LAST_RETRY_CHECK, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_RETRY_CHECK, value).apply()
}
