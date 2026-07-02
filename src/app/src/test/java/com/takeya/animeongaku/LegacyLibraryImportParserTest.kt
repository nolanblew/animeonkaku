package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParseException
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParser
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImportEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LegacyLibraryImportParserTest {
    private val parser = LegacyLibraryImportParser(
        Moshi.Builder()
            .add(KotlinJsonAdapterFactory())
            .build()
    )

    @Test
    fun `parses old Room export sections and ignores playlists`() {
        val payload = parser.parse(
            """
            {
              "user_preferences": [
                { "themeId": 101, "isLiked": 1, "isDisliked": 0 },
                { "themeId": 102, "isLiked": 0, "isDisliked": 1 }
              ],
              "play_count": [
                { "themeId": 101, "playCount": 4, "lastPlayedAt": 1700000000000 },
                { "themeId": 103, "playCount": 2 }
              ],
              "playlists": [
                { "name": "Ignored", "entries": [101, 102] }
              ]
            }
            """.trimIndent()
        )

        assertEquals(
            listOf(
                OngakuLegacyLibraryImportEntry(
                    themeId = 101,
                    liked = true,
                    disliked = false,
                    playCount = 4,
                    lastPlayedAt = 1700000000000
                ),
                OngakuLegacyLibraryImportEntry(
                    themeId = 102,
                    liked = false,
                    disliked = true,
                    playCount = 0,
                    lastPlayedAt = null
                ),
                OngakuLegacyLibraryImportEntry(
                    themeId = 103,
                    liked = false,
                    disliked = false,
                    playCount = 2,
                    lastPlayedAt = null
                )
            ),
            payload.entries
        )
    }

    @Test
    fun `parses normalized legacy import entries`() {
        val payload = parser.parse(
            """
            {
              "entries": [
                { "theme_id": 201, "liked": true, "play_count": 7, "last_played_at": 42 }
              ]
            }
            """.trimIndent()
        )

        assertEquals(
            listOf(
                OngakuLegacyLibraryImportEntry(
                    themeId = 201,
                    liked = true,
                    disliked = false,
                    playCount = 7,
                    lastPlayedAt = 42
                )
            ),
            payload.entries
        )
    }

    @Test
    fun `rejects files with no legacy preferences or play counts`() {
        assertThrows(LegacyLibraryImportParseException::class.java) {
            parser.parse("""{ "playlists": [{ "name": "Nope" }] }""")
        }
    }

    @Test
    fun `rejects entries that are both liked and disliked`() {
        assertThrows(LegacyLibraryImportParseException::class.java) {
            parser.parse(
                """
                {
                  "entries": [
                    { "themeId": 99, "liked": true, "disliked": true }
                  ]
                }
                """.trimIndent()
            )
        }
    }
}
