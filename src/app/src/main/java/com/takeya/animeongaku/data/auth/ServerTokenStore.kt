package com.takeya.animeongaku.data.auth

import android.content.SharedPreferences
import javax.inject.Inject
import javax.inject.Singleton

data class ServerSession(
    val token: String,
    val kitsuUserId: String,
    val username: String
)

@Singleton
class ServerTokenStore @Inject constructor(
    private val prefs: SharedPreferences
) {
    fun save(session: ServerSession) {
        prefs.edit()
            .putString(KEY_TOKEN, session.token)
            .putString(KEY_KITSU_USER_ID, session.kitsuUserId)
            .putString(KEY_USERNAME, session.username)
            .apply()
    }

    fun currentToken(): String? = prefs.getString(KEY_TOKEN, null)

    fun currentSession(): ServerSession? {
        val token = currentToken() ?: return null
        val kitsuUserId = prefs.getString(KEY_KITSU_USER_ID, null) ?: return null
        val username = prefs.getString(KEY_USERNAME, null) ?: return null
        return ServerSession(
            token = token,
            kitsuUserId = kitsuUserId,
            username = username
        )
    }

    fun clear() {
        prefs.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_KITSU_USER_ID)
            .remove(KEY_USERNAME)
            .apply()
    }

    companion object {
        private const val KEY_TOKEN = "ongaku_server_token"
        private const val KEY_KITSU_USER_ID = "ongaku_server_kitsu_user_id"
        private const val KEY_USERNAME = "ongaku_server_username"
    }
}
