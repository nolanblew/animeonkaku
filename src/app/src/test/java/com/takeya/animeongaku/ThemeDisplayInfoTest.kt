package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.common.displayInfo
import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeDisplayInfoTest {

    private fun theme(
        id: Long = 1L,
        title: String = "Song Title",
        artistName: String? = "Artist Name",
        themeType: String? = null,
        animeId: Long? = null
    ) = ThemeEntity(
        id = id,
        animeId = animeId,
        title = title,
        artistName = artistName,
        audioUrl = "https://example.com/audio.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null,
        themeType = themeType
    )

    private fun anime(title: String, atId: Long = 1L) = AnimeEntity(
        kitsuId = "k1",
        animeThemesId = atId,
        title = title,
        thumbnailUrl = null,
        coverUrl = null,
        syncedAt = 0L
    )

    // ─── primaryText ──────────────────────────────────────────────────────────

    @Test
    fun `primary shows animeName dot themeType when both present`() {
        val info = theme(themeType = "OP1").displayInfo(anime("Naruto"))
        assertEquals("Naruto · OP1", info.primaryText)
    }

    @Test
    fun `primary shows animeName only when themeType is null`() {
        val info = theme(themeType = null).displayInfo(anime("Naruto"))
        assertEquals("Naruto", info.primaryText)
    }

    @Test
    fun `primary shows animeName only when themeType is blank`() {
        val info = theme(themeType = "").displayInfo(anime("Naruto"))
        assertEquals("Naruto", info.primaryText)
    }

    @Test
    fun `primary shows themeType dot title when anime is null`() {
        val info = theme(title = "Silhouette", themeType = "OP1").displayInfo(null)
        assertEquals("OP1 · Silhouette", info.primaryText)
    }

    @Test
    fun `primary falls back to title when both anime and themeType are null`() {
        val info = theme(title = "Silhouette", themeType = null).displayInfo(null)
        assertEquals("Silhouette", info.primaryText)
    }

    @Test
    fun `primary falls back to title when anime title is blank`() {
        val info = theme(title = "Silhouette", themeType = null).displayInfo(anime(""))
        assertEquals("Silhouette", info.primaryText)
    }

    // ─── secondaryText ────────────────────────────────────────────────────────

    @Test
    fun `secondary shows title dot artist when artist is present`() {
        val info = theme(title = "Silhouette", artistName = "KANA-BOON").displayInfo(null)
        assertEquals("Silhouette · KANA-BOON", info.secondaryText)
    }

    @Test
    fun `secondary falls back to title when artist is null`() {
        val info = theme(title = "Silhouette", artistName = null).displayInfo(null)
        assertEquals("Silhouette", info.secondaryText)
    }

    @Test
    fun `secondary falls back to title when artist is blank`() {
        val info = theme(title = "Silhouette", artistName = "").displayInfo(null)
        assertEquals("Silhouette", info.secondaryText)
    }

    // ─── combined scenarios ───────────────────────────────────────────────────

    @Test
    fun `full info with anime and artist`() {
        val info = theme(title = "Blue Bird", artistName = "Ikimono-gakari", themeType = "OP3")
            .displayInfo(anime("Naruto Shippuden"))
        assertEquals("Naruto Shippuden · OP3", info.primaryText)
        assertEquals("Blue Bird · Ikimono-gakari", info.secondaryText)
    }

    @Test
    fun `no anime no artist falls back to title for both`() {
        val info = theme(title = "Blue Bird", artistName = null, themeType = null).displayInfo(null)
        assertEquals("Blue Bird", info.primaryText)
        assertEquals("Blue Bird", info.secondaryText)
    }
}
