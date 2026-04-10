package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.library.filterLibrarySongs
import com.takeya.animeongaku.ui.library.librarySongsContextLabel
import org.junit.Assert.assertEquals
import org.junit.Test

class LibrarySongsQueueTest {

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = null,
        title = "Song $id",
        artistName = null,
        audioUrl = "https://example.com/$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    @Test
    fun `filterLibrarySongs returns all songs when download filter is off`() {
        val songs = listOf(theme(1), theme(2), theme(3))

        val filtered = filterLibrarySongs(
            allSongs = songs,
            downloadedThemeIds = setOf(2L),
            showDownloadedOnly = false
        )

        assertEquals(listOf(1L, 2L, 3L), filtered.map { it.id })
    }

    @Test
    fun `filterLibrarySongs keeps only downloaded songs in original order`() {
        val songs = listOf(theme(1), theme(2), theme(3), theme(4))

        val filtered = filterLibrarySongs(
            allSongs = songs,
            downloadedThemeIds = setOf(4L, 2L),
            showDownloadedOnly = true
        )

        assertEquals(listOf(2L, 4L), filtered.map { it.id })
    }

    @Test
    fun `librarySongsContextLabel reflects active songs collection`() {
        assertEquals("All Songs", librarySongsContextLabel(showDownloadedOnly = false))
        assertEquals("Downloaded Songs", librarySongsContextLabel(showDownloadedOnly = true))
    }
}
