package com.takeya.animeongaku.data.auth

import android.content.SharedPreferences
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * One-time copy of the session token and server settings from the legacy
 * EncryptedSharedPreferences store into a plain store. EncryptedSharedPreferences'
 * keyset is fragile across app updates/restores; once it corrupts, the token is lost.
 * Reading the legacy store is wrapped in runCatching so a corrupt keyset degrades to
 * "no prior token" instead of crashing.
 */
@Singleton
class SessionStorageMigrator @Inject constructor(
    @Named("session") private val sessionPrefs: SharedPreferences,
    @Named("legacyEncrypted") private val legacyPrefs: SharedPreferences
) {
    fun migrateIfNeeded() {
        if (sessionPrefs.getBoolean(KEY_MIGRATED, false)) return
        runCatching {
            val editor = sessionPrefs.edit()
            val all = legacyPrefs.all
            for (key in MIGRATED_KEYS) {
                when (val value = all[key]) {
                    is String -> editor.putString(key, value)
                    is Long -> editor.putLong(key, value)
                    is Boolean -> editor.putBoolean(key, value)
                }
            }
            editor.apply()
        }
        // Always set the flag, even if the legacy store threw, so we never retry it.
        sessionPrefs.edit().putBoolean(KEY_MIGRATED, true).apply()
    }

    companion object {
        private const val KEY_MIGRATED = "tether_storage_migrated"
        private val MIGRATED_KEYS = listOf(
            "ongaku_server_token",
            "ongaku_server_kitsu_user_id",
            "ongaku_server_username",
            "ongaku_server_base_url",
            "ongaku_server_pull_cursor",
            "ongaku_server_last_pull_at",
            "ongaku_server_migration_complete"
        )
    }
}
