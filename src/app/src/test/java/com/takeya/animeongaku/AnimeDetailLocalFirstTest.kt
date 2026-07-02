package com.takeya.animeongaku

import com.takeya.animeongaku.ui.library.shouldFetchAnimeDetailFromServer
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeDetailLocalFirstTest {
    @Test
    fun `library anime with local themes does not need blocking server detail fetch`() {
        assertFalse(
            shouldFetchAnimeDetailFromServer(
                hasLocalAnime = true,
                localThemeCount = 3
            )
        )
    }

    @Test
    fun `missing local detail still fetches from server`() {
        assertTrue(
            shouldFetchAnimeDetailFromServer(
                hasLocalAnime = false,
                localThemeCount = 0
            )
        )
        assertTrue(
            shouldFetchAnimeDetailFromServer(
                hasLocalAnime = true,
                localThemeCount = 0
            )
        )
    }
}
