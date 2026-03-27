package com.takeya.animeongaku.network

import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException
import kotlin.math.min
import kotlin.random.Random
import okhttp3.Interceptor
import okhttp3.Response

class RetryInterceptor(
    private val maxRetries: Int = 2,
    private val baseDelayMs: Long = 300L,
    private val maxDelayMs: Long = 2_000L
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val isIdempotent = request.method == "GET" || request.method == "HEAD"

        var attempt = 0
        var lastException: IOException? = null

        while (attempt <= maxRetries) {
            try {
                val response = chain.proceed(request)
                if (!shouldRetry(response, isIdempotent, attempt)) {
                    return response
                }
                response.close()
            } catch (ioException: IOException) {
                if (ioException is UnknownHostException || ioException is ConnectException) {
                    throw ioException
                }
                lastException = ioException
                if (!isIdempotent || attempt >= maxRetries) {
                    throw ioException
                }
            }

            val delay = computeDelay(attempt)
            Thread.sleep(delay)
            attempt += 1
        }

        throw lastException ?: IOException("RetryInterceptor failed without exception")
    }

    private fun shouldRetry(response: Response, isIdempotent: Boolean, attempt: Int): Boolean {
        if (!isIdempotent || attempt >= maxRetries) return false
        return response.code in setOf(408, 429, 500, 502, 503, 504)
    }

    private fun computeDelay(attempt: Int): Long {
        val exponential = baseDelayMs * (1 shl attempt)
        val jitter = Random.nextLong(0, baseDelayMs)
        return min(maxDelayMs, exponential + jitter)
    }
}
