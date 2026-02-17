package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.auth.KitsuAuthRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response

@Singleton
class KitsuAuthInterceptor @Inject constructor(
    private val authRepository: KitsuAuthRepository
) : Interceptor {
    private val lock = Any()

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val path = request.url.encodedPath
        if (request.url.host != "kitsu.io" || !path.startsWith("/api/edge/")) {
            return chain.proceed(request)
        }

        val token = synchronized(lock) {
            runBlocking {
                authRepository.refreshIfNeeded()
            } ?: authRepository.currentToken()
        }

        val builder = request.newBuilder()
            .header("Accept", "application/vnd.api+json")
            .header("Content-Type", "application/vnd.api+json")

        if (token != null) {
            builder.header("Authorization", "Bearer ${token.accessToken}")
        }

        return chain.proceed(builder.build())
    }
}
