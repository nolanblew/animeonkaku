package com.takeya.animeongaku

import com.takeya.animeongaku.media.MediaDataRoute
import com.takeya.animeongaku.media.buildServerMediaHttpClient
import com.takeya.animeongaku.media.resolveMediaDataRoute
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OriginAwareMediaRoutingTest {
    private val serverBase = "http://192.168.68.68:3000/api/"

    @Test
    fun `configured server media uses bearer and SimpleCache`() {
        val route = resolveMediaDataRoute(
            "http://192.168.68.68:3000/api/v1/media/audio/42",
            serverBase
        )

        assertEquals(MediaDataRoute.SERVER_AUDIO, route)
        assertTrue(route.usesBearerToken)
        assertTrue(route.usesSimpleCache)
    }

    @Test
    fun `direct AnimeThemes video is anonymous and uncached`() {
        val route = resolveMediaDataRoute(
            "https://v.animethemes.moe/Example-OP1.webm",
            serverBase
        )

        assertEquals(MediaDataRoute.DIRECT_REMOTE, route)
        assertFalse(route.usesBearerToken)
        assertFalse(route.usesSimpleCache)
    }

    @Test
    fun `same host outside configured server base is never authenticated`() {
        val route = resolveMediaDataRoute(
            "http://192.168.68.68:3000/public/video.webm",
            serverBase
        )

        assertEquals(MediaDataRoute.DIRECT_REMOTE, route)
        assertFalse(route.usesBearerToken)
        assertFalse(route.usesSimpleCache)
    }

    @Test
    fun `file and content URIs use local handling`() {
        assertEquals(MediaDataRoute.LOCAL, resolveMediaDataRoute("file:///music/song.flac", serverBase))
        assertEquals(MediaDataRoute.LOCAL, resolveMediaDataRoute("content://downloads/song", serverBase))
    }

    @Test
    fun `server redirect to foreign origin never forwards bearer`() {
        val server = MockWebServer()
        val foreign = MockWebServer()
        server.start()
        foreign.start()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(302)
                    .addHeader("Location", foreign.url("/captured"))
            )
            foreign.enqueue(MockResponse().setBody("ok"))
            val activeBase = server.url("/api/").toString()
            val client = buildServerMediaHttpClient(
                activeServerBaseUrl = { activeBase },
                accessToken = { "top-secret" }
            )

            client.newCall(Request.Builder().url(server.url("/api/v1/media/audio/42")).build())
                .execute()
                .use { response -> assertEquals(200, response.code) }

            assertEquals("Bearer top-secret", server.takeRequest().getHeader("Authorization"))
            assertEquals(null, foreign.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
            foreign.shutdown()
        }
    }

    @Test
    fun `same origin redirect outside server path drops bearer`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(
                MockResponse()
                    .setResponseCode(302)
                    .addHeader("Location", server.url("/public/captured"))
            )
            server.enqueue(MockResponse().setBody("ok"))
            val activeBase = server.url("/api/").toString()
            val client = buildServerMediaHttpClient(
                activeServerBaseUrl = { activeBase },
                accessToken = { "top-secret" }
            )

            client.newCall(Request.Builder().url(server.url("/api/v1/media/audio/42")).build())
                .execute()
                .use { response -> assertEquals(200, response.code) }

            assertEquals("Bearer top-secret", server.takeRequest().getHeader("Authorization"))
            assertEquals(null, server.takeRequest().getHeader("Authorization"))
        } finally {
            server.shutdown()
        }
    }
}
