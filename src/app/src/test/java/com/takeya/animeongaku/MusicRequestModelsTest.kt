package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.OngakuMusicRequestEnvelope
import com.takeya.animeongaku.data.repository.toDomain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MusicRequestModelsTest {
    private val adapter = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
        .adapter(OngakuMusicRequestEnvelope::class.java)

    @Test
    fun `safe server summary deserializes and maps typed state`() {
        val envelope = adapter.fromJson(
            """{
              "request": {
                "id": "request-1", "kitsuId": "123", "state": "AWAITING_OPERATOR",
                "batchCount": 2,
                "counts": {"queued":0,"searching":0,"awaitingOperator":1,"downloading":0,
                  "processing":0,"completed":1,"completedWithWarnings":0,"failed":0,"cancelled":0},
                "requiresOperatorAction": true,
                "lastUpdatedAt": "2026-07-21T20:00:00.000Z", "pollAfterSeconds": 7
              },
              "replayed": true
            }""".trimIndent()
        )!!

        val request = envelope.request!!.toDomain()
        assertEquals("request-1", request.id)
        assertEquals(1, request.counts.awaitingOperator)
        assertEquals(7, request.pollAfterSeconds)
        assertEquals(true, envelope.replayed)
    }

    @Test
    fun `latest response supports explicit no request`() {
        assertNull(adapter.fromJson("""{"request":null}""")!!.request)
    }
}
