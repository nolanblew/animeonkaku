package com.takeya.animeongaku

import com.takeya.animeongaku.network.isServerUrl
import com.takeya.animeongaku.network.serverMediaRequestHeaders
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerMediaRequestHeadersTest {
    @Test
    fun `bearer headers are only emitted for nonblank tokens`() {
        assertEquals(emptyMap<String, String>(), serverMediaRequestHeaders(null))
        assertEquals(emptyMap<String, String>(), serverMediaRequestHeaders(" "))
        assertEquals(mapOf("Authorization" to "Bearer token-123"), serverMediaRequestHeaders("token-123"))
    }

    @Test
    fun `server url detection matches configured origin and base path`() {
        val baseUrl = "http://192.168.1.5:8080/api/"

        assertTrue(isServerUrl(baseUrl, "http://192.168.1.5:8080/api/v1/media/audio/100"))
        assertTrue(isServerUrl(baseUrl, "http://192.168.1.5:8080/api/v1/media/images/anime/1/poster"))
        assertFalse(isServerUrl(baseUrl, "https://cdn.example.test/audio.webm"))
        assertFalse(isServerUrl(baseUrl, "http://192.168.1.5:8080/other/v1/media/audio/100"))
    }
}
