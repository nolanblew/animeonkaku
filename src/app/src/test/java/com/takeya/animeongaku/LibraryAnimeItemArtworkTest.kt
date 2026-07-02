package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.ui.library.animeItemCoverUrls
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryAnimeItemArtworkTest {
    @Test
    fun `library anime cards expose server first fallback artwork urls`() {
        val anime = AnimeEntity(
            kitsuId = "13635",
            animeThemesId = 89123,
            title = "16bit Sensation",
            thumbnailUrl = "https://media.kitsu.test/poster.jpg",
            thumbnailUrlLarge = "https://media.kitsu.test/poster-large.jpg",
            coverUrl = "https://media.kitsu.test/cover.jpg",
            coverUrlLarge = "https://media.kitsu.test/cover-large.jpg",
            syncedAt = 0L
        )

        assertEquals(
            listOf(
                "https://ongaku.local/v1/media/images/anime/13635/cover",
                "https://ongaku.local/v1/media/images/anime/13635/poster",
                "https://media.kitsu.test/cover.jpg",
                "https://media.kitsu.test/cover-large.jpg",
                "https://media.kitsu.test/poster.jpg",
                "https://media.kitsu.test/poster-large.jpg"
            ),
            animeItemCoverUrls(anime)
        )
    }
}
