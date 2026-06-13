package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.OngakuLibraryResponse
import com.takeya.animeongaku.data.remote.OngakuLoginResponse
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OngakuModelsTest {
    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    @Test
    fun `parses server login response`() {
        val adapter = moshi.adapter(OngakuLoginResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "token": "opaque-token",
              "user": { "kitsuUserId": "12345", "username": "nblewtest" },
              "isNewUser": true
            }
            """.trimIndent()
        )!!

        assertEquals("opaque-token", response.token)
        assertEquals("12345", response.user.kitsuUserId)
        assertEquals("nblewtest", response.user.username)
        assertTrue(response.isNewUser)
    }

    @Test
    fun `parses library feed with tombstones and theme audio state`() {
        val adapter = moshi.adapter(OngakuLibraryResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "serverTime": 1760000000000,
              "anime": [
                {
                  "kitsuId": "1",
                  "animeThemesId": 10,
                  "title": "Bocchi the Rock!",
                  "titleEn": "Bocchi the Rock!",
                  "titleRomaji": null,
                  "titleJa": null,
                  "posterUrl": "/v1/media/images/anime/1/poster",
                  "coverUrl": null,
                  "watchingStatus": "current",
                  "subtype": "TV",
                  "startDate": "2022-10-09",
                  "endDate": null,
                  "episodeCount": 12,
                  "ageRating": "PG",
                  "averageRating": 8.7,
                  "userRating": 9.0,
                  "libraryUpdatedAt": 1758000000000,
                  "slug": "bocchi-the-rock",
                  "genres": ["Music"],
                  "updatedAt": 1759000000000,
                  "deleted": false
                },
                {
                  "kitsuId": "gone",
                  "animeThemesId": null,
                  "title": null,
                  "titleEn": null,
                  "titleRomaji": null,
                  "titleJa": null,
                  "posterUrl": null,
                  "coverUrl": null,
                  "watchingStatus": null,
                  "subtype": null,
                  "startDate": null,
                  "endDate": null,
                  "episodeCount": null,
                  "ageRating": null,
                  "averageRating": null,
                  "userRating": null,
                  "libraryUpdatedAt": null,
                  "slug": null,
                  "genres": [],
                  "updatedAt": 1759500000000,
                  "deleted": true
                }
              ],
              "themes": [
                {
                  "id": 100,
                  "animeThemesAnimeId": 10,
                  "kitsuAnimeIds": ["1"],
                  "title": "Seishun Complex",
                  "themeType": "OP1",
                  "artists": [{ "name": "Kessoku Band", "asCharacter": null, "alias": null }],
                  "audioUrl": "/v1/media/audio/100",
                  "videoUrl": null,
                  "audioState": "READY",
                  "durationSeconds": 90,
                  "fileSize": 5242880,
                  "updatedAt": 1759000000000,
                  "deleted": false
                }
              ]
            }
            """.trimIndent()
        )!!

        assertEquals(1760000000000, response.serverTime)
        assertFalse(response.anime[0].deleted)
        assertTrue(response.anime[1].deleted)
        assertEquals(listOf("Music"), response.anime[0].genres)
        assertEquals("READY", response.themes[0].audioState)
        assertEquals("Kessoku Band", response.themes[0].artists[0].name)
        assertNull(response.anime[1].title)
    }

    @Test
    fun `parses sync status response`() {
        val adapter = moshi.adapter(OngakuSyncStatusResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "state": "RUNNING",
              "phase": "MAPPING_THEMES",
              "progress": { "mapped": 3 },
              "lastCompletedAt": 1759000000000,
              "unmatched": ["Unknown Show"]
            }
            """.trimIndent()
        )!!

        assertEquals("RUNNING", response.state)
        assertEquals("MAPPING_THEMES", response.phase)
        assertEquals(1759000000000, response.lastCompletedAt)
        assertEquals(listOf("Unknown Show"), response.unmatched)
    }
}
