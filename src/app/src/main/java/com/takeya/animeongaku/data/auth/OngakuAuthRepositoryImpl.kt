package com.takeya.animeongaku.data.auth

import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuLoginRequest
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class OngakuAuthRepositoryImpl @Inject constructor(
    private val api: OngakuApi,
    private val tokenStore: ServerTokenStore
) : OngakuAuthRepository {
    override suspend fun login(username: String, password: String, deviceName: String): ServerSession {
        val response = api.login(
            OngakuLoginRequest(
                username = username,
                password = password,
                deviceName = deviceName
            )
        )
        val session = ServerSession(
            token = response.token,
            kitsuUserId = response.user.kitsuUserId,
            username = response.user.username
        )
        tokenStore.save(session)
        return session
    }

    override fun currentSession(): ServerSession? = tokenStore.currentSession()

    override fun clearSession() {
        tokenStore.clear()
    }
}
