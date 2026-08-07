package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.MusicRequestApi
import com.takeya.animeongaku.data.remote.OngakuMusicRequestEnvelope
import com.takeya.animeongaku.data.remote.OngakuMusicRequestStatusDto
import com.takeya.animeongaku.data.repository.MusicRequestScope
import com.takeya.animeongaku.data.repository.ServerMusicRequestRepository
import com.takeya.animeongaku.data.repository.toDomain
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.GET
import retrofit2.http.POST

class MusicRequestModelsTest {
    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    @Test
    fun `scoped server summary deserializes and maps typed scope`() {
        val adapter = moshi.adapter(OngakuMusicRequestEnvelope::class.java)
        val envelope = adapter.fromJson(
            """{
              "request": {
                "id": "request-1", "kitsuId": "123", "scope": "EXTRA_MUSIC",
                "state": "AWAITING_OPERATOR", "active": true, "batchCount": 2,
                "fullThemeCount": 0,
                "counts": {"queued":0,"searching":0,"awaitingOperator":1,"downloading":0,
                  "processing":0,"completed":1,"completedWithWarnings":0,"failed":0,"cancelled":0},
                "requiresOperatorAction": true,
                "lastUpdatedAt": "2026-08-07T20:00:00.000Z", "pollAfterSeconds": 7
              },
              "replayed": true
            }""".trimIndent()
        )!!

        val request = envelope.request!!.toDomain()
        assertEquals(MusicRequestScope.EXTRA_MUSIC, request.scope)
        assertEquals(1, request.counts.awaitingOperator)
        assertEquals(7, request.pollAfterSeconds)
        assertTrue(request.active)
        assertEquals(true, envelope.replayed)
    }

    @Test
    fun `combined status maps availability independently per scope`() {
        val adapter = moshi.adapter(OngakuMusicRequestStatusDto::class.java)
        val status = adapter.fromJson(
            """{
              "kitsuId": "123",
              "scopes": [
                {"scope":"FULL_SONGS","latest":null,"active":false,
                 "eligibleCount":4,"availableCount":1,"missingCount":3},
                {"scope":"EXTRA_MUSIC","latest":null,"active":false,
                 "eligibleCount":2,"availableCount":2,"missingCount":0}
              ]
            }""".trimIndent()
        )!!.toDomain()

        assertEquals("123", status.kitsuId)
        assertEquals(3, status[MusicRequestScope.FULL_SONGS].missingCount)
        assertEquals(0, status[MusicRequestScope.EXTRA_MUSIC].missingCount)
        assertFalse(status[MusicRequestScope.EXTRA_MUSIC].active)
    }

    @Test
    fun `latest response supports explicit no request`() {
        val adapter = moshi.adapter(OngakuMusicRequestEnvelope::class.java)
        assertNull(adapter.fromJson("""{"request":null}""")!!.request)
    }

    @Test
    fun `retrofit contract exposes both scoped posts and combined status get`() {
        val methods = MusicRequestApi::class.java.methods.associateBy { it.name }

        assertEquals(
            "v1/anime/{kitsuId}/music-requests/full-songs",
            methods.getValue("createFullSongs").getAnnotation(POST::class.java).value
        )
        assertEquals(
            "v1/anime/{kitsuId}/music-requests/extra-music",
            methods.getValue("createExtraMusic").getAnnotation(POST::class.java).value
        )
        assertEquals(
            "v1/anime/{kitsuId}/music-requests/status",
            methods.getValue("status").getAnnotation(GET::class.java).value
        )
    }

    @Test
    fun `repository routes requests by scope and maps combined status`() = runTest {
        val api = FakeMusicRequestApi()
        val repository = ServerMusicRequestRepository(api)

        assertEquals(MusicRequestScope.FULL_SONGS, repository.request("123", MusicRequestScope.FULL_SONGS).scope)
        assertEquals(MusicRequestScope.EXTRA_MUSIC, repository.request("123", MusicRequestScope.EXTRA_MUSIC).scope)
        assertEquals(2, repository.status("123").scopes.size)
        assertEquals(listOf("full:123", "extra:123", "status:123"), api.calls)
    }
}

private class FakeMusicRequestApi : MusicRequestApi {
    val calls = mutableListOf<String>()

    override suspend fun create(kitsuId: String): OngakuMusicRequestEnvelope = createFullSongs(kitsuId)

    override suspend fun createFullSongs(kitsuId: String): OngakuMusicRequestEnvelope {
        calls += "full:$kitsuId"
        return envelope("full-1", "FULL_SONGS")
    }

    override suspend fun createExtraMusic(kitsuId: String): OngakuMusicRequestEnvelope {
        calls += "extra:$kitsuId"
        return envelope("extra-1", "EXTRA_MUSIC")
    }

    override suspend fun get(requestId: String): OngakuMusicRequestEnvelope = envelope(requestId, "FULL_SONGS")

    override suspend fun latest(kitsuId: String): OngakuMusicRequestEnvelope = envelope("full-1", "FULL_SONGS")

    override suspend fun status(kitsuId: String): OngakuMusicRequestStatusDto {
        calls += "status:$kitsuId"
        return moshiStatus()
    }

    private fun envelope(id: String, scope: String): OngakuMusicRequestEnvelope {
        val adapter = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
            .adapter(OngakuMusicRequestEnvelope::class.java)
        return adapter.fromJson(
            """{"request":{"id":"$id","kitsuId":"123","scope":"$scope","state":"QUEUED",
              "active":true,"batchCount":1,"fullThemeCount":1,"counts":{"queued":1},
              "requiresOperatorAction":false,"lastUpdatedAt":"now","pollAfterSeconds":5}}"""
        )!!
    }

    private fun moshiStatus(): OngakuMusicRequestStatusDto {
        val adapter = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
            .adapter(OngakuMusicRequestStatusDto::class.java)
        return adapter.fromJson(
            """{"kitsuId":"123","scopes":[
              {"scope":"FULL_SONGS","latest":null,"active":false,"eligibleCount":1,"availableCount":0,"missingCount":1},
              {"scope":"EXTRA_MUSIC","latest":null,"active":false,"eligibleCount":2,"availableCount":0,"missingCount":2}
            ]}"""
        )!!
    }
}
