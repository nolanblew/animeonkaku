package com.takeya.animeongaku

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.importer.LegacyLibraryImportParser
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LegacyLibraryImportParserInstrumentedTest {
    @Test
    fun validatesSampleLegacyExportOnDevice() {
        val parser = LegacyLibraryImportParser(
            Moshi.Builder()
                .add(KotlinJsonAdapterFactory())
                .build()
        )

        val payload = parser.parse(
            """
            {
              "sampleAccount": "legacy-import-sample",
              "user_preferences": [
                { "themeId": 100, "isLiked": 1, "isDisliked": 0 }
              ],
              "play_count": [
                { "themeId": 100, "playCount": 3, "lastPlayedAt": 1700000000000 }
              ]
            }
            """.trimIndent()
        )

        assertEquals(1, payload.entries.size)
        assertEquals(100L, payload.entries.single().themeId)
        assertEquals(true, payload.entries.single().liked)
        assertEquals(3, payload.entries.single().playCount)
    }
}
