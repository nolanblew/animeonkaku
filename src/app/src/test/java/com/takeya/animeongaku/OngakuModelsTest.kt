package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImportEntry
import com.takeya.animeongaku.data.remote.OngakuLibraryResponse
import com.takeya.animeongaku.data.remote.OngakuLoginRequest
import com.takeya.animeongaku.data.remote.OngakuLoginResponse
import com.takeya.animeongaku.data.remote.OngakuChangesResponse
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatchJsonAdapter
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
    fun `theme preference DTO and patch preserve preferred mode`() {
        val dto = moshi.adapter(OngakuThemePrefDto::class.java).fromJson(
            """{"themeId":1,"liked":false,"disliked":false,"preferredMode":"FULL_SIZE","playCount":0,"lastPlayedAt":null}"""
        )!!
        val patchJson = moshi.adapter(OngakuThemePrefPatch::class.java).toJson(
            OngakuThemePrefPatch(preferredMode = "TV_SIZE")
        )

        assertEquals("FULL_SIZE", dto.preferredMode)
        assertTrue(patchJson.contains("\"preferredMode\":\"TV_SIZE\""))
    }

    @Test
    fun `theme preference patch distinguishes explicit inherit from an omitted field`() {
        val adapter = Moshi.Builder()
            .add(OngakuThemePrefPatch::class.java, OngakuThemePrefPatchJsonAdapter())
            .add(KotlinJsonAdapterFactory())
            .build()
            .adapter(OngakuThemePrefPatch::class.java)

        val inheritJson = adapter.toJson(
            OngakuThemePrefPatch(preferredMode = null, includePreferredMode = true)
        )
        val reactionJson = adapter.toJson(OngakuThemePrefPatch(liked = true))

        assertTrue(inheritJson.contains("\"preferredMode\":null"))
        assertFalse(reactionJson.contains("preferredMode"))
    }

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
    fun `serializes login request with legacy import payload`() {
        val adapter = moshi.adapter(OngakuLoginRequest::class.java)
        val json = adapter.toJson(
            OngakuLoginRequest(
                username = "nblewtest",
                password = "hunter2",
                deviceName = "Pixel 9",
                legacyLibraryImport = OngakuLegacyLibraryImport(
                    entries = listOf(
                        OngakuLegacyLibraryImportEntry(
                            themeId = 100,
                            liked = true,
                            playCount = 3,
                            lastPlayedAt = 1700000000000
                        )
                    )
                )
            )
        )

        assertTrue(json.contains(""""legacyLibraryImport""""))
        assertTrue(json.contains(""""themeId":100"""))
        assertTrue(json.contains(""""liked":true"""))
        assertTrue(json.contains(""""playCount":3"""))
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
    fun `old changes response safely defaults additive music fields`() {
        val adapter = moshi.adapter(OngakuChangesResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "serverTime": 1760000000000,
              "anime": [],
              "themes": [],
              "prefs": [],
              "playlists": []
            }
            """.trimIndent()
        )!!

        assertNull(response.songPrefs)
        assertNull(response.musicCatalog)
    }

    @Test
    fun `incremental changes may omit unchanged theme and catalog snapshots`() {
        val adapter = moshi.adapter(OngakuChangesResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "serverTime": 1760000000001,
              "anime": [],
              "prefs": [],
              "playlists": []
            }
            """.trimIndent()
        )!!

        assertNull(response.themes)
        assertNull(response.musicCatalog)
    }

    @Test
    fun `parses additive media catalog playlist preferences and play contracts`() {
        val adapter = moshi.adapter(OngakuChangesResponse::class.java)
        val response = adapter.fromJson(
            """
            {
              "serverTime": 1760000000000,
              "anime": [],
              "themes": [{
                "id": 100, "animeThemesAnimeId": 10, "kitsuAnimeIds": ["1"],
                "title": "Seishun Complex", "themeType": "OP1", "artists": [],
                "audioUrl": "/v1/media/audio/100", "videoUrl": null, "audioState": "READY",
                "durationSeconds": 90, "fileSize": 5242880,
                "mediaModes": {
                  "tvSize": { "url": "/v1/media/audio/100", "durationSeconds": 90, "fileSize": 5242880 },
                  "fullSize": { "songId": 300, "url": "/v1/media/songs/300/audio", "durationSeconds": 271, "fileSize": 1234, "sourceReleaseId": 200 },
                  "video": { "url": "https://v.animethemes.moe/op.webm", "mimeType": "video/webm", "spoiler": false, "nsfw": false, "entryVersion": 1 }
                },
                "updatedAt": 1759000000000, "deleted": false
              }],
              "prefs": [{
                "themeId": 100, "liked": false, "disliked": false,
                "dislikedTvSize": true, "dislikedFullSize": false,
                "playCount": 2, "lastPlayedAt": 1759000000000,
                "updatedAt": 1759000000000, "deleted": false
              }],
              "songPrefs": [{
                "songId": 300, "liked": true, "disliked": false,
                "playCount": 3, "lastPlayedAt": 1759000000000,
                "updatedAt": 1759000000000, "deleted": false
              }],
              "playlists": [{
                "id": 7, "name": "Mixed", "entries": [100], "defaultMode": "FULL_SIZE",
                "items": [
                  { "entryId": 70, "itemType": "THEME", "itemId": 100, "modeOverride": null },
                  { "entryId": 71, "itemType": "SONG", "itemId": 300, "modeOverride": null }
                ],
                "isAuto": false, "updatedAt": 1759000000000,
                "dynamicSpecJson": null, "deleted": false
              }],
              "musicCatalog": [{
                "anime": { "kitsuId": "1", "title": "Bocchi the Rock!", "titleEn": "Bocchi the Rock!", "posterUrl": "/v1/media/images/anime/1/poster" },
                "releases": [{
                  "id": 200, "title": "Original Soundtrack", "artistCredit": "Tomoki Kikuya",
                  "relationshipType": "SOUNDTRACK", "releaseDate": "2022-12-28", "year": 2022,
                  "artworkUrl": "/v1/media/images/releases/200", "tracks": [{
                    "id": 300, "title": "Morning Light", "artistCredit": "Kessoku Band",
                    "durationSeconds": 271, "audioUrl": "/v1/media/songs/300/audio", "fileSize": 1234,
                    "discNumber": 1, "trackNumber": 2, "displayOrder": 1
                  }]
                }]
              }]
            }
            """.trimIndent()
        )!!

        assertEquals(300L, response.themes!!.single().mediaModes?.fullSize?.songId)
        assertEquals("https://v.animethemes.moe/op.webm", response.themes!!.single().mediaModes?.video?.url)
        assertTrue(response.prefs.single().dislikedTvSize)
        assertEquals(300L, response.songPrefs!!.single().songId)
        assertEquals("FULL_SIZE", response.playlists.single().defaultMode)
        assertEquals(listOf("THEME", "SONG"), response.playlists.single().items.map { it.itemType })
        assertEquals(2, response.musicCatalog!!.single().releases.single().tracks.single().trackNumber)
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
