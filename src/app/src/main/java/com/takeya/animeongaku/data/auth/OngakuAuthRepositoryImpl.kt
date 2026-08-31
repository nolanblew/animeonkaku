package com.takeya.animeongaku.data.auth

import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.remote.OngakuLoginRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OngakuAuthRepositoryImpl @Inject constructor(
    private val api: OngakuApi,
    private val tokenStore: ServerTokenStore
) : OngakuAuthRepository {
    override suspend fun login(
        username: String,
        password: String,
        deviceName: String,
        legacyLibraryImport: OngakuLegacyLibraryImport?
    ): ServerLoginResult {
        val response = api.login(
            OngakuLoginRequest(
                username = username,
                password = password,
                deviceName = deviceName,
                legacyLibraryImport = legacyLibraryImport
            )
        )
        val session = ServerSession(
            token = response.token,
            kitsuUserId = response.user.kitsuUserId,
            username = response.user.username
        )
        tokenStore.save(session)
        return ServerLoginResult(
            session = session,
            // Older servers omit syncMode; a full first sync is always safe.
            syncMode = when (response.syncMode) {
                "NONE" -> ServerSyncMode.NONE
                "DELTA" -> ServerSyncMode.DELTA
                else -> ServerSyncMode.FULL
            },
            isNewUser = response.isNewUser
        )
    }

    override suspend fun logout() {
        try {
            api.logout()
        } finally {
            // Local logout must complete even if the server is temporarily unreachable.
            tokenStore.clear()
        }
    }

    override fun currentSession(): ServerSession? = tokenStore.currentSession()

    override fun clearSession() {
        tokenStore.clear()
    }
}
