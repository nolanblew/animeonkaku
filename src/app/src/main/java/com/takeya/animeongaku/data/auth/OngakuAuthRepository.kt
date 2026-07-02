package com.takeya.animeongaku.data.auth

import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport

/**
 * Which first-sync the server decided to run for this login. FULL for new
 * users or libraries not synced within ~6 months; DELTA when the server's
 * copy is recent and only needs topping up.
 */
enum class ServerSyncMode { FULL, DELTA }

data class ServerLoginResult(
    val session: ServerSession,
    val syncMode: ServerSyncMode
)

interface OngakuAuthRepository {
    suspend fun login(
        username: String,
        password: String,
        deviceName: String,
        legacyLibraryImport: OngakuLegacyLibraryImport? = null
    ): ServerLoginResult
    fun currentSession(): ServerSession?
    fun clearSession()
}
