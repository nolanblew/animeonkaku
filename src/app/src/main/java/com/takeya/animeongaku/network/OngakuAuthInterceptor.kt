package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.auth.ServerTokenStore
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.Interceptor
import okhttp3.Response

@Singleton
class OngakuAuthInterceptor @Inject constructor(
    private val tokenStore: ServerTokenStore
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenStore.currentToken()
        val request = if (token.isNullOrBlank()) {
            chain.request()
        } else {
            chain.request().newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }

        val response = chain.proceed(request)
        if (response.code == 401) {
            tokenStore.clear()
        }
        return response
    }
}
