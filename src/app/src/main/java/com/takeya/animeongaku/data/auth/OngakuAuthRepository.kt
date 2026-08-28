package com.takeya.animeongaku.data.auth

import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport

/**
 * Which first-sync the server decided to run for this login. FULL for new
 * users or libraries not synced within ~30 days; DELTA when the server's
 * copy is recent and only needs topping up.
 */
enum class ServerSyncMode { FULL, DELTA, NONE }

data class ServerLoginResult(
    val session: ServerSession,
    val syncMode: ServerSyncMode,
    val isNewUser: Boolean = true
)

interface OngakuAuthRepository {
    suspend fun login(
        username: String,
        password: String,
        deviceName: String,
        legacyLibraryImport: OngakuLegacyLibraryImport? = null
    ): ServerLoginResult
    suspend fun logout()
    fun currentSession(): ServerSession?
    fun clearSession()
}
