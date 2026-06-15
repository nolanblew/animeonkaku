package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.backgroundArtworkUrls
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeArtworkTest {
    private fun anime(
        kitsuId: String,
        thumbnailUrl: String? = null,
        coverUrl: String? = null
    ) = AnimeEntity(
        kitsuId = kitsuId,
        animeThemesId = null,
        title = "Test",
        thumbnailUrl = thumbnailUrl,
        coverUrl = coverUrl,
        syncedAt = 0L
    )

    @Test
    fun `null stored artwork still yields kitsu-derived media route fallbacks`() {
        // 48312 has no stored artwork (synced before its cover existed, and it is
        // not a library entry so the delta pull never backfills it). It must still
        // resolve to the deterministic server image route so the server can serve art.
        val urls = anime(kitsuId = "48312").primaryArtworkUrls()

        assertEquals(
            listOf(
                "https://ongaku.local/v1/media/images/anime/48312/cover",
                "https://ongaku.local/v1/media/images/anime/48312/poster"
            ),
            urls
        )
    }

    @Test
    fun `stored artwork is tried first, derived route appended as fallback`() {
        val urls = anime(
            kitsuId = "8403",
            coverUrl = "http://127.0.0.1:8080/v1/media/images/anime/8403/cover",
            thumbnailUrl = "http://127.0.0.1:8080/v1/media/images/anime/8403/poster"
        ).primaryArtworkUrls()

        assertEquals("http://127.0.0.1:8080/v1/media/images/anime/8403/cover", urls.first())
        assertTrue(urls.contains("https://ongaku.local/v1/media/images/anime/8403/cover"))
        assertTrue(urls.contains("https://ongaku.local/v1/media/images/anime/8403/poster"))
    }

    @Test
    fun `background artwork prefers poster route then cover route`() {
        val urls = anime(kitsuId = "8403").backgroundArtworkUrls()

        assertEquals(
            listOf(
                "https://ongaku.local/v1/media/images/anime/8403/poster",
                "https://ongaku.local/v1/media/images/anime/8403/cover"
            ),
            urls
        )
    }

    @Test
    fun `blank kitsu id yields no derived urls`() {
        assertEquals(emptyList<String>(), anime(kitsuId = "").primaryArtworkUrls())
    }
}
