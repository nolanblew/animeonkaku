package com.takeya.animeongaku

import com.takeya.animeongaku.di.NetworkModule
import com.takeya.animeongaku.network.RetryInterceptor
import java.net.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkModuleTest {
    @Test
    fun `base http client bypasses device proxy settings`() {
        val client = NetworkModule.provideBaseOkHttpClient()

        assertSame(Proxy.NO_PROXY, client.proxy)
    }

    @Test
    fun `image http client preserves transport deadlines for slow full size artwork`() {
        val base = NetworkModule.provideBaseOkHttpClient()
        val client = NetworkModule.provideImageOkHttpClient(base)

        assertEquals(base.connectTimeoutMillis, client.connectTimeoutMillis)
        assertEquals(base.readTimeoutMillis, client.readTimeoutMillis)
        assertEquals(base.writeTimeoutMillis, client.writeTimeoutMillis)
        assertEquals(base.callTimeoutMillis, client.callTimeoutMillis)
    }

    @Test
    fun `image http client does not use generic api retry loop`() {
        val client = NetworkModule.provideImageOkHttpClient(NetworkModule.provideBaseOkHttpClient())

        assertTrue(client.interceptors.none { it is RetryInterceptor })
    }
}
