package com.takeya.animeongaku

import com.takeya.animeongaku.di.NetworkModule
import java.net.Proxy
import org.junit.Assert.assertSame
import org.junit.Test

class NetworkModuleTest {
    @Test
    fun `base http client bypasses device proxy settings`() {
        val client = NetworkModule.provideBaseOkHttpClient()

        assertSame(Proxy.NO_PROXY, client.proxy)
    }
}
