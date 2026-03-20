package com.takeya.animeongaku.data.auth

import android.content.SharedPreferences

class KitsuTokenStore(
    private val prefs: SharedPreferences
) {
    fun save(token: KitsuToken) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, token.accessToken)
            .putString(KEY_REFRESH_TOKEN, token.refreshToken)
            .putLong(KEY_EXPIRES_AT, token.expiresAtMillis)
            .apply()
    }

    fun load(): KitsuToken? {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null)
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        if (expiresAt == 0L) return null
        return KitsuToken(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAtMillis = expiresAt
        )
    }

    fun clear() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_EXPIRES_AT)
            .apply()
    }

    fun saveLastSyncedAt(timestamp: Long) {
        prefs.edit().putLong(KEY_LAST_SYNCED_AT, timestamp).apply()
    }

    fun getLastSyncedAt(): Long = prefs.getLong(KEY_LAST_SYNCED_AT, 0L)

    fun saveLastStatusSyncAt(timestamp: Long) {
        prefs.edit().putLong(KEY_LAST_STATUS_SYNC_AT, timestamp).apply()
    }

    fun getLastStatusSyncAt(): Long = prefs.getLong(KEY_LAST_STATUS_SYNC_AT, 0L)

    fun saveUsername(username: String) {
        prefs.edit().putString(KEY_USERNAME, username).apply()
    }

    fun getUsername(): String? = prefs.getString(KEY_USERNAME, null)

    fun saveUserId(userId: String) {
        prefs.edit().putString(KEY_USER_ID, userId).apply()
    }

    fun getUserId(): String? = prefs.getString(KEY_USER_ID, null)

    fun clearAll() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_EXPIRES_AT)
            .remove(KEY_LAST_SYNCED_AT)
            .remove(KEY_LAST_STATUS_SYNC_AT)
            .remove(KEY_USERNAME)
            .remove(KEY_USER_ID)
            .apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "kitsu_access_token"
        private const val KEY_REFRESH_TOKEN = "kitsu_refresh_token"
        private const val KEY_EXPIRES_AT = "kitsu_expires_at"
        private const val KEY_LAST_SYNCED_AT = "kitsu_last_synced_at"
        private const val KEY_LAST_STATUS_SYNC_AT = "kitsu_last_status_sync_at"
        private const val KEY_USERNAME = "kitsu_username"
        private const val KEY_USER_ID = "kitsu_user_id"
    }
}
