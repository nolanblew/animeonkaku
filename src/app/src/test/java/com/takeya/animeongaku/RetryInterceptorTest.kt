package com.takeya.animeongaku

import com.takeya.animeongaku.network.RetryInterceptor
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class RetryInterceptorTest {

    private fun getRequest(url: String = "https://example.com/api") =
        Request.Builder().url(url).get().build()

    private fun postRequest(url: String = "https://example.com/api") =
        Request.Builder().url(url).post("{}".toRequestBody()).build()

    private fun String.toRequestBody() =
        toByteArray().toResponseBody("application/json".toMediaType()).let {
            okhttp3.RequestBody.create("application/json".toMediaType(), this)
        }

    private fun fakeResponse(code: Int, request: Request): Response =
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(code)
            .message("Fake")
            .body("".toResponseBody("text/plain".toMediaType()))
            .build()

    /**
     * Builds a fake [Interceptor.Chain] that returns responses from [responseProvider]
     * on each call to proceed(). Tracks how many times proceed() was called.
     */
    private fun fakeChain(
        request: Request,
        responseProvider: (attempt: Int) -> Response
    ): Pair<Interceptor.Chain, () -> Int> {
        var callCount = 0
        val chain = object : Interceptor.Chain {
            override fun request() = request
            override fun proceed(request: Request): Response {
                val current = callCount
                callCount++
                return responseProvider(current)
            }
            override fun connection() = null
            override fun call(): okhttp3.Call = throw UnsupportedOperationException()
            override fun connectTimeoutMillis() = 0
            override fun withConnectTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
            override fun readTimeoutMillis() = 0
            override fun withReadTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
            override fun writeTimeoutMillis() = 0
            override fun withWriteTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit) = this
        }
        return chain to { callCount }
    }

    // ─── Success on first attempt ─────────────────────────────────────────────

    @Test
    fun `200 response is returned immediately without retry`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 0)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(200, request) }

        val response = interceptor.intercept(chain)

        assertEquals(200, response.code)
        assertEquals(1, callCount())
    }

    // ─── Retry on retryable status codes ─────────────────────────────────────

    @Test
    fun `500 response is retried for GET requests`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 1)
        val request = getRequest()
        var attempt = 0
        val (chain, callCount) = fakeChain(request) { _ ->
            val code = if (attempt++ < 2) 500 else 200
            fakeResponse(code, request)
        }

        val response = interceptor.intercept(chain)

        assertEquals(200, response.code)
        assertEquals(3, callCount())
    }

    @Test
    fun `retryable codes include 408 429 500 502 503 504`() {
        val retryCodes = listOf(408, 429, 500, 502, 503, 504)
        for (code in retryCodes) {
            val interceptor = RetryInterceptor(maxRetries = 1, baseDelayMs = 1)
            val request = getRequest()
            var attempt = 0
            val (chain, callCount) = fakeChain(request) { _ ->
                if (attempt++ == 0) fakeResponse(code, request)
                else fakeResponse(200, request)
            }
            val response = interceptor.intercept(chain)
            assertEquals("Expected retry on $code", 200, response.code)
            assertEquals("Expected 2 calls for $code", 2, callCount())
        }
    }

    @Test
    fun `non-retryable 404 is returned without retry`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 0)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(404, request) }

        val response = interceptor.intercept(chain)

        assertEquals(404, response.code)
        assertEquals(1, callCount())
    }

    @Test
    fun `non-retryable 401 is returned without retry`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 0)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(401, request) }

        val response = interceptor.intercept(chain)

        assertEquals(401, response.code)
        assertEquals(1, callCount())
    }

    // ─── POST requests are not retried ────────────────────────────────────────

    @Test
    fun `POST request is not retried on 500`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 0)
        val request = postRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(500, request) }

        val response = interceptor.intercept(chain)

        assertEquals(500, response.code)
        assertEquals(1, callCount())
    }

    // ─── IOException handling ─────────────────────────────────────────────────

    @Test
    fun `IOException is retried for GET up to maxRetries times`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 1)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { attempt ->
            if (attempt < 2) throw IOException("Network error")
            fakeResponse(200, request)
        }

        val response = interceptor.intercept(chain)

        assertEquals(200, response.code)
        assertEquals(3, callCount())
    }

    @Test
    fun `IOException on POST is thrown immediately without retry`() {
        val interceptor = RetryInterceptor(maxRetries = 2, baseDelayMs = 0)
        val request = postRequest()
        val (chain, _) = fakeChain(request) { throw IOException("Network error") }

        try {
            interceptor.intercept(chain)
            fail("Expected IOException to be thrown")
        } catch (e: IOException) {
            assertEquals("Network error", e.message)
        }
    }

    @Test
    fun `IOException exceeding maxRetries is rethrown`() {
        val interceptor = RetryInterceptor(maxRetries = 1, baseDelayMs = 1)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { _ -> throw IOException("Always fails") }

        try {
            interceptor.intercept(chain)
            fail("Expected IOException to be thrown")
        } catch (e: IOException) {
            assertEquals("Always fails", e.message)
        }
        assertEquals(2, callCount()) // 1 initial + 1 retry
    }

    // ─── maxRetries boundary ──────────────────────────────────────────────────

    @Test
    fun `retries exactly maxRetries times then returns last response`() {
        val interceptor = RetryInterceptor(maxRetries = 3, baseDelayMs = 1)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(503, request) }

        val response = interceptor.intercept(chain)

        assertEquals(503, response.code)
        assertEquals(4, callCount()) // 1 initial + 3 retries
    }

    @Test
    fun `zero maxRetries means no retries`() {
        val interceptor = RetryInterceptor(maxRetries = 0, baseDelayMs = 0)
        val request = getRequest()
        val (chain, callCount) = fakeChain(request) { fakeResponse(500, request) }

        val response = interceptor.intercept(chain)

        assertEquals(500, response.code)
        assertEquals(1, callCount())
    }
}
