package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.ui.search.normalizeAnimeSearchText
import com.takeya.animeongaku.ui.search.searchAnimeCandidates
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeSearchMatcherTest {
    @Test
    fun `normalizes ampersand and silent x connector variants`() {
        assertEquals("spy family", normalizeAnimeSearchText("SPY×FAMILY"))
        assertEquals("spy family", normalizeAnimeSearchText("Spy Family"))
        assertEquals("spy family", normalizeAnimeSearchText("Spy cross Family"))
        assertEquals("love and lies", normalizeAnimeSearchText("Love & Lies"))
        assertEquals("love and lies", normalizeAnimeSearchText("Love and Lies"))
        assertEquals("hunter hunter", normalizeAnimeSearchText("HUNTER x HUNTER"))
    }

    @Test
    fun `searches alternate English title fields`() {
        val fullmetalAlchemist = anime("fullmetal", "鋼の錬金術師").copy(
            titleEn = "Fullmetal Alchemist"
        )

        assertEquals(
            listOf(fullmetalAlchemist),
            searchAnimeCandidates("Full Metal Alchemist", listOf(fullmetalAlchemist))
        )
    }

    @Test
    fun `matches spoken x and ampersand variants locally`() {
        val spyFamily = anime("spy", "SPY×FAMILY")
        val hunterHunter = anime("hunter", "HUNTER×HUNTER")
        val loveAndLies = anime("love", "Love & Lies")

        assertEquals(listOf(spyFamily), searchAnimeCandidates("Spy Family", listOf(spyFamily)))
        assertEquals(listOf(hunterHunter), searchAnimeCandidates("Hunter Hunter", listOf(hunterHunter)))
        assertEquals(listOf(loveAndLies), searchAnimeCandidates("Love and Lies", listOf(loveAndLies)))
    }

    @Test
    fun `allows a light typo without returning unrelated anime`() {
        val jujutsuKaisen = anime("jujutsu", "Jujutsu Kaisen")
        val hunterHunter = anime("hunter", "Hunter×Hunter")

        val results = searchAnimeCandidates(
            query = "Jujutu Kaisen",
            candidates = listOf(hunterHunter, jujutsuKaisen)
        )

        assertEquals(listOf(jujutsuKaisen), results)
    }

    @Test
    fun `returns no matches for blank or overly different queries`() {
        val spyFamily = anime("spy", "Spy×Family")

        assertTrue(searchAnimeCandidates("   ", listOf(spyFamily)).isEmpty())
        assertTrue(searchAnimeCandidates("One Piece", listOf(spyFamily)).isEmpty())
    }

    private fun anime(kitsuId: String, title: String) = AnimeEntity(
        kitsuId = kitsuId,
        animeThemesId = kitsuId.hashCode().toLong(),
        title = title,
        thumbnailUrl = null,
        coverUrl = null,
        syncedAt = 0L
    )
}
