package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.Interceptor
import okhttp3.Response

@Singleton
class OngakuBaseUrlInterceptor @Inject constructor(
    private val settingsStore: ServerSettingsStore
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val baseUrl = settingsStore.serverBaseHttpUrl() ?: return chain.proceed(request)

        val basePath = baseUrl.encodedPath.trim('/')
        val requestPath = request.url.encodedPath.trimStart('/')
        val joinedPath = listOf(basePath, requestPath)
            .filter { it.isNotBlank() }
            .joinToString(separator = "/", prefix = "/")

        val newUrl = request.url.newBuilder()
            .scheme(baseUrl.scheme)
            .host(baseUrl.host)
            .port(baseUrl.port)
            .encodedPath(joinedPath)
            .build()

        return chain.proceed(request.newBuilder().url(newUrl).build())
    }
}
