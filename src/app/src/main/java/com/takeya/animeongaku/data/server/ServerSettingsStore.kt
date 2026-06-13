package com.takeya.animeongaku.data.server

import android.content.SharedPreferences
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

@Singleton
class ServerSettingsStore @Inject constructor(
    private val prefs: SharedPreferences
) {
    var serverBaseUrl: String?
        get() = prefs.getString(KEY_SERVER_BASE_URL, null)
        set(value) {
            val normalized = normalizeBaseUrl(value)
            prefs.edit()
                .apply {
                    if (normalized == null) remove(KEY_SERVER_BASE_URL)
                    else putString(KEY_SERVER_BASE_URL, normalized)
                }
                .apply()
        }

    val isConfigured: Boolean
        get() = serverBaseUrl != null

    var serverPullCursor: Long
        get() = prefs.getLong(KEY_SERVER_PULL_CURSOR, 0L)
        set(value) {
            prefs.edit().putLong(KEY_SERVER_PULL_CURSOR, value.coerceAtLeast(0L)).apply()
        }

    var serverLastPullAt: Long
        get() = prefs.getLong(KEY_SERVER_LAST_PULL_AT, 0L)
        set(value) {
            prefs.edit().putLong(KEY_SERVER_LAST_PULL_AT, value.coerceAtLeast(0L)).apply()
        }

    val isServerMigrationComplete: Boolean
        get() = prefs.getBoolean(KEY_SERVER_MIGRATION_COMPLETE, false)

    fun serverBaseHttpUrl(): HttpUrl? = serverBaseUrl?.toHttpUrlOrNull()

    fun markServerMigrationComplete() {
        prefs.edit().putBoolean(KEY_SERVER_MIGRATION_COMPLETE, true).apply()
    }

    fun resetServerMigration() {
        prefs.edit().remove(KEY_SERVER_MIGRATION_COMPLETE).apply()
    }

    companion object {
        private const val KEY_SERVER_BASE_URL = "ongaku_server_base_url"
        private const val KEY_SERVER_PULL_CURSOR = "ongaku_server_pull_cursor"
        private const val KEY_SERVER_LAST_PULL_AT = "ongaku_server_last_pull_at"
        private const val KEY_SERVER_MIGRATION_COMPLETE = "ongaku_server_migration_complete"

        fun normalizeBaseUrl(value: String?): String? {
            val trimmed = value?.trim().orEmpty()
            if (trimmed.isBlank()) return null
            val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
            val withSlash = if (withScheme.endsWith("/")) withScheme else "$withScheme/"
            return withSlash.toHttpUrlOrNull()?.toString()
        }
    }
}
