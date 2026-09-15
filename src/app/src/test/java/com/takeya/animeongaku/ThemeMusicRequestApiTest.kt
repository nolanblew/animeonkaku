package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.MusicRequestApi
import com.takeya.animeongaku.data.repository.ServerMusicRequestRepository
import com.takeya.animeongaku.data.repository.ThemeMusicRequestReason
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

class ThemeMusicRequestApiTest {
    @Test fun `report posts exact identity and reason and exposes review requirement`() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(202).setBody(response(45)))
            val result = repository(server).requestTheme("123", 45, ThemeMusicRequestReason.INCORRECT_FULL_SIZE)
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/v1/anime/123/themes/45/music-requests", request.path)
            assertEquals("{\"reason\":\"INCORRECT_FULL_SIZE\"}", request.body.readUtf8())
            assertTrue(result.manualSelectionRequired)
            assertEquals("request-1", result.request.id)
        } finally { server.shutdown() }
    }

    @Test fun `response for another song is never presented as accepted`() = runTest {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(202).setBody(response(99)))
            val error = runCatching {
                repository(server).requestTheme("123", 45, ThemeMusicRequestReason.INCORRECT_FULL_SIZE)
            }.exceptionOrNull()
            assertTrue(error is IllegalArgumentException)
        } finally { server.shutdown() }
    }

    private fun repository(server: MockWebServer) = ServerMusicRequestRepository(
        Retrofit.Builder().baseUrl(server.url("/"))
            .addConverterFactory(MoshiConverterFactory.create(Moshi.Builder().add(KotlinJsonAdapterFactory()).build()))
            .build().create(MusicRequestApi::class.java)
    )

    private fun response(themeId: Long) = """{
        "themeId":$themeId,"manualSelectionRequired":true,"replayed":false,
        "request":{"id":"request-1","kitsuId":"123","scope":"FULL_SONGS","state":"QUEUED",
        "active":true,"batchCount":1,"fullThemeCount":1,"counts":{"queued":1},
        "requiresOperatorAction":false,"lastUpdatedAt":"now","pollAfterSeconds":5}
    }""".trimIndent()
}
