package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.Interceptor
import okhttp3.Response

@Singleton
class OngakuAuthInterceptor @Inject constructor(
    private val tokenStore: ServerTokenStore,
    private val sessionStateManager: SessionStateManager
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.currentToken()
        if (token.isNullOrBlank()) {
            // No bearer to attach (e.g. the login request) — never touch session state.
            return chain.proceed(chain.request())
        }

        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        val response = chain.proceed(request)

        when {
            response.code == 401 -> sessionStateManager.markUnauthorized()
            response.isSuccessful -> sessionStateManager.markAuthorized()
        }
        return response
    }
}
