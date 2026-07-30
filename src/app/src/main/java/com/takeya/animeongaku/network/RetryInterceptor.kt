package com.takeya.animeongaku.network

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
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
            if (isCancelled(chain)) {
                throw InterruptedIOException("Request cancelled before retry")
            }
            try {
                val response = chain.proceed(request)
                if (!shouldRetry(response, isIdempotent, attempt)) {
                    return response
                }
                response.close()
            } catch (ioException: IOException) {
                if (!isIdempotent || attempt >= maxRetries || !isTransientNetworkFailure(ioException)) {
                    throw ioException
                }
                lastException = ioException
            }

            if (isCancelled(chain)) {
                throw InterruptedIOException("Request cancelled before backoff")
            }
            val delay = computeDelay(attempt)
            try {
                Thread.sleep(delay)
            } catch (interrupted: InterruptedException) {
                Thread.currentThread().interrupt()
                throw InterruptedIOException("Retry backoff interrupted").apply { initCause(interrupted) }
            }
            attempt += 1
        }

        throw lastException ?: IOException("RetryInterceptor failed without exception")
    }

    private fun shouldRetry(response: Response, isIdempotent: Boolean, attempt: Int): Boolean {
        if (!isIdempotent || attempt >= maxRetries) return false
        // A failed cache fetch is terminal until a new server-side discovery/fetch succeeds.
        // Retrying it only adds player latency and duplicate traffic while preserving no value.
        if (response.code == 503 && response.peekBody(16L * 1024L).string()
                .contains("AUDIO_UNAVAILABLE", ignoreCase = false)
        ) return false
        return response.code in setOf(408, 429, 502, 503, 504)
    }

    private fun isCancelled(chain: Interceptor.Chain): Boolean = try {
        chain.call().isCanceled()
    } catch (_: UnsupportedOperationException) {
        // Lightweight JVM fakes may not model a Call; production OkHttp chains always do.
        false
    }

    private fun isTransientNetworkFailure(error: IOException): Boolean = when (error) {
        // A refused TCP connection is immediately actionable by the caller and retrying here
        // blocks foreground playback with no useful chance of recovery.
        is ConnectException -> false
        is SocketTimeoutException, is SocketException ->
            !Thread.currentThread().isInterrupted && !error.isCancellationLike()
        is UnknownHostException, is InterruptedIOException -> false
        else -> false
    }

    private fun IOException.isCancellationLike(): Boolean {
        val message = message.orEmpty()
        return message.contains("cancel", ignoreCase = true) ||
            message.contains("closed", ignoreCase = true)
    }

    private fun computeDelay(attempt: Int): Long {
        val exponential = baseDelayMs * (1 shl attempt)
        val jitter = Random.nextLong(0, baseDelayMs)
        return min(maxDelayMs, exponential + jitter)
    }
}
