package com.takeya.animeongaku

import com.takeya.animeongaku.data.model.ArtistCredit
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Tests for the ArtistCredit data model and how it integrates
 * with AnimeThemeEntry for display and cross-ref generation.
 */
class ArtistCreditParsingTest {

    // ─── ArtistCredit model ───────────────────────────────────────────────────

    @Test
    fun `ArtistCredit stores name and character separately`() {
        val credit = ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san")
        assertEquals("Rie Takahashi", credit.name)
        assertEquals("Takagi-san", credit.asCharacter)
    }

    @Test
    fun `ArtistCredit without character has null asCharacter`() {
        val credit = ArtistCredit(name = "LiSA")
        assertNull(credit.asCharacter)
        assertNull(credit.alias)
    }

    @Test
    fun `ArtistCredit stores alias`() {
        val credit = ArtistCredit(name = "Honeyworks", alias = "HW")
        assertEquals("HW", credit.alias)
    }

    // ─── AnimeThemeEntry with structured artists ──────────────────────────────

    private fun entry(
        artists: List<ArtistCredit> = emptyList(),
        artist: String? = null
    ) = AnimeThemeEntry(
        animeId = "1",
        themeId = "100",
        title = "Test Song",
        artist = artist,
        audioUrl = "https://example.com/audio.mp3",
        videoUrl = null,
        artists = artists
    )

    @Test
    fun `entry with structured artists preserves all credits`() {
        val credits = listOf(
            ArtistCredit(name = "LiSA"),
            ArtistCredit(name = "Honeyworks"),
            ArtistCredit(name = "CHiCO", asCharacter = null)
        )
        val e = entry(artists = credits)
        assertEquals(3, e.artists.size)
        assertEquals("LiSA", e.artists[0].name)
        assertEquals("Honeyworks", e.artists[1].name)
        assertEquals("CHiCO", e.artists[2].name)
    }

    @Test
    fun `entry with CV character preserves character name`() {
        val credits = listOf(
            ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san")
        )
        val e = entry(artists = credits)
        assertEquals("Takagi-san", e.artists[0].asCharacter)
    }

    @Test
    fun `entry with empty artists list falls back to artist string`() {
        val e = entry(artist = "Some Artist", artists = emptyList())
        assertEquals(0, e.artists.size)
        assertEquals("Some Artist", e.artist)
    }

    // ─── Display string generation (mirrors SyncManager.toEntity logic) ──────

    private fun buildDisplayArtist(credits: List<ArtistCredit>, fallback: String?): String? {
        return if (credits.isNotEmpty()) {
            credits.joinToString(", ") { credit ->
                if (credit.asCharacter != null) {
                    "${credit.name} (as ${credit.asCharacter})"
                } else {
                    credit.name
                }
            }
        } else {
            fallback
        }
    }

    @Test
    fun `display string for single artist without character`() {
        val result = buildDisplayArtist(listOf(ArtistCredit(name = "LiSA")), null)
        assertEquals("LiSA", result)
    }

    @Test
    fun `display string for single artist with character`() {
        val result = buildDisplayArtist(
            listOf(ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san")),
            null
        )
        assertEquals("Rie Takahashi (as Takagi-san)", result)
    }

    @Test
    fun `display string for multiple artists`() {
        val result = buildDisplayArtist(
            listOf(
                ArtistCredit(name = "LiSA"),
                ArtistCredit(name = "Honeyworks"),
                ArtistCredit(name = "CHiCO")
            ),
            null
        )
        assertEquals("LiSA, Honeyworks, CHiCO", result)
    }

    @Test
    fun `display string for mixed artists with and without characters`() {
        val result = buildDisplayArtist(
            listOf(
                ArtistCredit(name = "LiSA"),
                ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san"),
                ArtistCredit(name = "CHiCO")
            ),
            null
        )
        assertEquals("LiSA, Rie Takahashi (as Takagi-san), CHiCO", result)
    }

    @Test
    fun `display string falls back to artist string when no credits`() {
        val result = buildDisplayArtist(emptyList(), "Fallback Artist")
        assertEquals("Fallback Artist", result)
    }

    @Test
    fun `display string is null when no credits and no fallback`() {
        val result = buildDisplayArtist(emptyList(), null)
        assertNull(result)
    }

    // ─── Cross-ref generation (mirrors SyncManager.toCrossRefs logic) ────────

    data class CrossRef(
        val themeId: Long,
        val artistName: String,
        val asCharacter: String?,
        val alias: String?
    )

    private fun toCrossRefs(themeId: Long, credits: List<ArtistCredit>): List<CrossRef> {
        return credits.map { credit ->
            CrossRef(
                themeId = themeId,
                artistName = credit.name,
                asCharacter = credit.asCharacter,
                alias = credit.alias
            )
        }
    }

    @Test
    fun `cross-refs generated for each artist credit`() {
        val credits = listOf(
            ArtistCredit(name = "LiSA"),
            ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san"),
            ArtistCredit(name = "CHiCO", alias = "Chico with HoneyWorks")
        )
        val refs = toCrossRefs(100L, credits)
        assertEquals(3, refs.size)

        assertEquals("LiSA", refs[0].artistName)
        assertNull(refs[0].asCharacter)

        assertEquals("Rie Takahashi", refs[1].artistName)
        assertEquals("Takagi-san", refs[1].asCharacter)

        assertEquals("CHiCO", refs[2].artistName)
        assertEquals("Chico with HoneyWorks", refs[2].alias)

        refs.forEach { assertEquals(100L, it.themeId) }
    }

    @Test
    fun `cross-refs empty when no credits`() {
        assertEquals(emptyList<CrossRef>(), toCrossRefs(100L, emptyList()))
    }

    // ─── Individual artist search correctness ─────────────────────────────────

    @Test
    fun `multi-artist song creates separate cross-refs for each artist`() {
        // Simulates: "Aimi Tanaka, Haruka Shiraishi" as two separate artists
        val credits = listOf(
            ArtistCredit(name = "Aimi Tanaka"),
            ArtistCredit(name = "Haruka Shiraishi")
        )
        val refs = toCrossRefs(200L, credits)
        assertEquals(2, refs.size)
        assertEquals("Aimi Tanaka", refs[0].artistName)
        assertEquals("Haruka Shiraishi", refs[1].artistName)
    }

    @Test
    fun `feat artist creates separate cross-ref`() {
        // API already separates "Honeyworks feat. CHiCO" into two artists
        val credits = listOf(
            ArtistCredit(name = "Honeyworks"),
            ArtistCredit(name = "CHiCO")
        )
        val refs = toCrossRefs(300L, credits)
        assertEquals(2, refs.size)
        assertEquals("Honeyworks", refs[0].artistName)
        assertEquals("CHiCO", refs[1].artistName)
    }

    @Test
    fun `complex multi-artist with CV creates correct cross-refs`() {
        // Simulates: LiSA, Honeyworks feat. CHiCO, Takagi-san (CV: Rie Takahashi)
        // API provides these as separate artist entries with structured data
        val credits = listOf(
            ArtistCredit(name = "LiSA"),
            ArtistCredit(name = "Honeyworks"),
            ArtistCredit(name = "CHiCO"),
            ArtistCredit(name = "Rie Takahashi", asCharacter = "Takagi-san")
        )
        val refs = toCrossRefs(400L, credits)
        assertEquals(4, refs.size)
        assertEquals("LiSA", refs[0].artistName)
        assertEquals("Honeyworks", refs[1].artistName)
        assertEquals("CHiCO", refs[2].artistName)
        assertEquals("Rie Takahashi", refs[3].artistName)
        assertEquals("Takagi-san", refs[3].asCharacter)
    }
}
