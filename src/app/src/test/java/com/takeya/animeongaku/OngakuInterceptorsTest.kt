package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.OngakuAuthInterceptor
import com.takeya.animeongaku.network.OngakuBaseUrlInterceptor
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OngakuInterceptorsTest {
    @Test
    fun `base url interceptor rewrites placeholder url to configured server`() {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val interceptor = OngakuBaseUrlInterceptor(settings)
        var proceededRequest: Request? = null
        val original = Request.Builder()
            .url("https://ongaku.local/v1/auth/me?fresh=true")
            .get()
            .build()

        interceptor.intercept(fakeChain(original) { request ->
            proceededRequest = request
            fakeResponse(200, request)
        })

        assertEquals("http://192.168.1.5:8080/api/v1/auth/me?fresh=true", proceededRequest!!.url.toString())
    }

    @Test
    fun `auth interceptor adds bearer token`() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("opaque-token", "12345", "nblewtest"))
        }
        val interceptor = OngakuAuthInterceptor(tokenStore)
        var proceededRequest: Request? = null
        val original = Request.Builder()
            .url("https://ongaku.local/v1/auth/me")
            .get()
            .build()

        interceptor.intercept(fakeChain(original) { request ->
            proceededRequest = request
            fakeResponse(200, request)
        })

        assertEquals("Bearer opaque-token", proceededRequest!!.header("Authorization"))
    }

    @Test
    fun `auth interceptor clears server session on 401`() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("opaque-token", "12345", "nblewtest"))
        }
        val interceptor = OngakuAuthInterceptor(tokenStore)
        val original = Request.Builder()
            .url("https://ongaku.local/v1/auth/me")
            .get()
            .build()

        interceptor.intercept(fakeChain(original) { request -> fakeResponse(401, request) }).close()

        assertNull(tokenStore.currentToken())
    }

    private fun fakeChain(
        request: Request,
        responseProvider: (Request) -> Response
    ): Interceptor.Chain = object : Interceptor.Chain {
        override fun request(): Request = request
        override fun proceed(request: Request): Response = responseProvider(request)
        override fun connection() = null
        override fun call(): okhttp3.Call = throw UnsupportedOperationException()
        override fun connectTimeoutMillis() = 0
        override fun withConnectTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
        override fun readTimeoutMillis() = 0
        override fun withReadTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
        override fun writeTimeoutMillis() = 0
        override fun withWriteTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
    }

    private fun fakeResponse(code: Int, request: Request): Response =
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(code)
            .message("Fake")
            .body("".toResponseBody("text/plain".toMediaType()))
            .build()
}
