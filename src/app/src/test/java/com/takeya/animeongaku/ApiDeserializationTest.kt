package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.remote.AnimeThemesApiResponse
import org.junit.Assert.*
import org.junit.Test

/**
 * Verifies Moshi correctly deserializes AnimeThemes API responses,
 * including nested artist data with artistsong fields.
 */
class ApiDeserializationTest {

    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val adapter = moshi.adapter(AnimeThemesApiResponse::class.java)

    // Minimal Toradora-like response with artists
    private val toradoraJson = """
    {
      "anime": [
        {
          "id": 2984,
          "name": "Toradora!",
          "resources": [],
          "animethemes": [
            {
              "id": 3040,
              "type": "OP",
              "sequence": 1,
              "song": {
                "title": "Pre-Parade",
                "artists": [
                  {
                    "name": "Eri Kitamura",
                    "slug": "eri_kitamura",
                    "artistsong": { "alias": null, "as": null }
                  },
                  {
                    "name": "Rie Kugimiya",
                    "slug": "rie_kugimiya",
                    "artistsong": { "alias": null, "as": null }
                  },
                  {
                    "name": "Yui Horie",
                    "slug": "yui_horie",
                    "artistsong": { "alias": null, "as": null }
                  }
                ]
              },
              "animethemeentries": [
                {
                  "videos": [
                    {
                      "link": "https://v.animethemes.moe/Toradora-OP1.webm",
                      "audio": {
                        "link": "https://a.animethemes.moe/Toradora-OP1.ogg",
                        "path": "2008/Fall/Toradora-OP1.ogg"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "id": 3041,
              "type": "OP",
              "sequence": 2,
              "song": {
                "title": "silky heart",
                "artists": [
                  {
                    "name": "Yui Horie",
                    "slug": "yui_horie",
                    "artistsong": { "alias": null, "as": null }
                  }
                ]
              },
              "animethemeentries": [
                {
                  "videos": [
                    {
                      "link": "https://v.animethemes.moe/Toradora-OP2.webm",
                      "audio": {
                        "link": "https://a.animethemes.moe/Toradora-OP2.ogg",
                        "path": "2008/Fall/Toradora-OP2.ogg"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "id": 3042,
              "type": "ED",
              "sequence": 1,
              "song": {
                "title": "Vanilla Salt",
                "artists": [
                  {
                    "name": "Yui Horie",
                    "slug": "yui_horie",
                    "artistsong": { "alias": null, "as": null }
                  }
                ]
              },
              "animethemeentries": [
                {
                  "videos": [
                    {
                      "link": "https://v.animethemes.moe/Toradora-ED1.webm",
                      "audio": {
                        "link": "https://a.animethemes.moe/Toradora-ED1.ogg",
                        "path": "2008/Fall/Toradora-ED1.ogg"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "id": 3044,
              "type": "ED",
              "sequence": 3,
              "song": {
                "title": "Holy Night",
                "artists": [
                  {
                    "name": "Eri Kitamura",
                    "slug": "eri_kitamura",
                    "artistsong": { "alias": null, "as": "Ami Kawashima" }
                  },
                  {
                    "name": "Rie Kugimiya",
                    "slug": "rie_kugimiya",
                    "artistsong": { "alias": null, "as": "Taiga Aisaka" }
                  }
                ]
              },
              "animethemeentries": [
                {
                  "videos": [
                    {
                      "link": "https://v.animethemes.moe/Toradora-ED3.webm",
                      "audio": {
                        "link": "https://a.animethemes.moe/Toradora-ED3.ogg",
                        "path": "2008/Fall/Toradora-ED3.ogg"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    """.trimIndent()

    @Test
    fun `deserializes anime with multiple artists`() {
        val response = adapter.fromJson(toradoraJson)!!
        assertEquals(1, response.anime.size)

        val anime = response.anime[0]
        assertEquals(2984L, anime.id)
        assertEquals("Toradora!", anime.name)
        assertEquals(4, anime.animethemes.size)
    }

    @Test
    fun `deserializes OP1 with three artists`() {
        val response = adapter.fromJson(toradoraJson)!!
        val op1 = response.anime[0].animethemes[0]

        assertEquals(3040L, op1.id)
        assertEquals("OP", op1.type)
        assertEquals("Pre-Parade", op1.song?.title)

        val artists = op1.song!!.artists
        assertEquals(3, artists.size)
        assertEquals("Eri Kitamura", artists[0].name)
        assertEquals("Rie Kugimiya", artists[1].name)
        assertEquals("Yui Horie", artists[2].name)

        // None have character roles
        artists.forEach { artist ->
            assertNull("${artist.name} should have null asCharacter", artist.artistsong?.asCharacter)
        }
    }

    @Test
    fun `deserializes ED3 with character voice roles`() {
        val response = adapter.fromJson(toradoraJson)!!
        val ed3 = response.anime[0].animethemes[3]

        assertEquals(3044L, ed3.id)
        assertEquals("Holy Night", ed3.song?.title)

        val artists = ed3.song!!.artists
        assertEquals(2, artists.size)

        assertEquals("Eri Kitamura", artists[0].name)
        assertEquals("Ami Kawashima", artists[0].artistsong?.asCharacter)

        assertEquals("Rie Kugimiya", artists[1].name)
        assertEquals("Taiga Aisaka", artists[1].artistsong?.asCharacter)
    }

    @Test
    fun `deserializes audio links correctly`() {
        val response = adapter.fromJson(toradoraJson)!!
        val op1 = response.anime[0].animethemes[0]
        val video = op1.animethemeentries[0].videos[0]

        assertEquals("https://v.animethemes.moe/Toradora-OP1.webm", video.link)
        assertEquals("https://a.animethemes.moe/Toradora-OP1.ogg", video.audio?.link)
    }

    // Test with extra unknown fields (API may return more fields than we model)
    private val jsonWithExtraFields = """
    {
      "anime": [
        {
          "id": 1,
          "name": "Test",
          "media_format": "TV",
          "season": "Fall",
          "slug": "test",
          "synopsis": "test synopsis",
          "year": 2020,
          "resources": [],
          "animethemes": [
            {
              "id": 100,
              "type": "OP",
              "sequence": 1,
              "slug": "OP1",
              "song": {
                "id": 100,
                "title": "Test Song",
                "artists": [
                  {
                    "id": 50,
                    "name": "Test Artist",
                    "slug": "test_artist",
                    "information": null,
                    "artistsong": { "alias": null, "as": null }
                  }
                ]
              },
              "animethemeentries": []
            }
          ]
        }
      ]
    }
    """.trimIndent()

    @Test
    fun `ignores unknown fields without crashing`() {
        val response = adapter.fromJson(jsonWithExtraFields)!!
        assertEquals(1, response.anime.size)
        assertEquals("Test Artist", response.anime[0].animethemes[0].song?.artists?.get(0)?.name)
    }

    // Test empty artists list
    private val jsonNoArtists = """
    {
      "anime": [
        {
          "id": 1,
          "name": "Test",
          "resources": [],
          "animethemes": [
            {
              "id": 100,
              "type": "OP",
              "sequence": 1,
              "song": {
                "title": "No Artist Song",
                "artists": []
              },
              "animethemeentries": []
            }
          ]
        }
      ]
    }
    """.trimIndent()

    @Test
    fun `handles empty artists list`() {
        val response = adapter.fromJson(jsonNoArtists)!!
        val artists = response.anime[0].animethemes[0].song?.artists
        assertNotNull(artists)
        assertTrue(artists!!.isEmpty())
    }

    // Test missing song entirely
    private val jsonNoSong = """
    {
      "anime": [
        {
          "id": 1,
          "name": "Test",
          "resources": [],
          "animethemes": [
            {
              "id": 100,
              "type": "OP",
              "sequence": 1,
              "animethemeentries": []
            }
          ]
        }
      ]
    }
    """.trimIndent()

    @Test
    fun `handles missing song`() {
        val response = adapter.fromJson(jsonNoSong)!!
        assertNull(response.anime[0].animethemes[0].song)
    }

    // ─── End-to-end: simulate toThemeEntries pipeline ─────────────────────────

    @Test
    fun `full Toradora pipeline produces correct artist names and credits`() {
        val response = adapter.fromJson(toradoraJson)!!
        val anime = response.anime[0]

        // Simulate toThemeEntries logic for each theme
        anime.animethemes.forEach { theme ->
            val song = theme.song
            assertNotNull("song should not be null for theme ${theme.id}", song)

            val artistCredits = song!!.artists
                .filter { !it.name.isNullOrBlank() }
                .map { apiArtist ->
                    Triple(
                        apiArtist.name!!.trim(),
                        apiArtist.artistsong?.asCharacter?.trim()?.takeIf { it.isNotBlank() },
                        apiArtist.artistsong?.alias?.trim()?.takeIf { it.isNotBlank() }
                    )
                }

            val artistNames = song.artists
                .mapNotNull { it.name }
                .distinct()
                .filter { it.isNotBlank() }

            val joinedNames = if (artistNames.isEmpty()) null else artistNames.joinToString(", ")

            // Every Toradora theme should have at least one artist
            assertTrue(
                "Theme ${theme.id} (${song.title}) should have artists, got: $artistCredits",
                artistCredits.isNotEmpty()
            )
            assertNotNull(
                "Theme ${theme.id} (${song.title}) should have joined artist names",
                joinedNames
            )
        }
    }

    @Test
    fun `OP1 Pre-Parade has three artists`() {
        val response = adapter.fromJson(toradoraJson)!!
        val op1 = response.anime[0].animethemes[0]
        val names = op1.song!!.artists.mapNotNull { it.name }
        assertEquals(listOf("Eri Kitamura", "Rie Kugimiya", "Yui Horie"), names)
    }

    @Test
    fun `OP2 silky heart has one artist`() {
        val response = adapter.fromJson(toradoraJson)!!
        val op2 = response.anime[0].animethemes[1]
        val names = op2.song!!.artists.mapNotNull { it.name }
        assertEquals(listOf("Yui Horie"), names)
    }

    @Test
    fun `ED3 Holy Night has character voice roles`() {
        val response = adapter.fromJson(toradoraJson)!!
        val ed3 = response.anime[0].animethemes.last()
        assertEquals("Holy Night", ed3.song!!.title)

        val artists = ed3.song!!.artists
        assertEquals("Ami Kawashima", artists[0].artistsong?.asCharacter)
        assertEquals("Taiga Aisaka", artists[1].artistsong?.asCharacter)
    }
}
