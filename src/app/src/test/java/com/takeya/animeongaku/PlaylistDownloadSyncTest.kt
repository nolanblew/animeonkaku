package com.takeya.animeongaku

import com.takeya.animeongaku.download.newPlaylistDownloadThemeIds
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistDownloadSyncTest {
    @Test
    fun `themes added to a downloaded playlist are returned for download`() {
        assertEquals(
            listOf(30L, 40L),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 20L, 30L, 40L),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }

    @Test
    fun `nothing new when the playlist is unchanged`() {
        assertEquals(
            emptyList<Long>(),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 20L),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }

    @Test
    fun `duplicate playlist entries are only downloaded once`() {
        assertEquals(
            listOf(30L),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 30L, 30L),
                trackedThemeIds = setOf(10L)
            )
        )
    }

    @Test
    fun `removed tracks are not re-downloaded and an empty playlist adds nothing`() {
        // Tracks that left the playlist but remain tracked are simply ignored (no additions).
        assertEquals(
            emptyList<Long>(),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = emptyList(),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }
}
