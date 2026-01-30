package com.takeya.animeongaku.network

import android.os.SystemClock
import okhttp3.Interceptor
import okhttp3.Response

class RateLimitInterceptor(
    private val minDelayMs: Long = 350L
) : Interceptor {
    private val lock = Any()
    private var lastRequestAt = 0L

    override fun intercept(chain: Interceptor.Chain): Response {
        synchronized(lock) {
            val now = SystemClock.elapsedRealtime()
            val waitTime = minDelayMs - (now - lastRequestAt)
            if (waitTime > 0) {
                Thread.sleep(waitTime)
            }
            lastRequestAt = SystemClock.elapsedRealtime()
        }

        return chain.proceed(chain.request())
    }
}
