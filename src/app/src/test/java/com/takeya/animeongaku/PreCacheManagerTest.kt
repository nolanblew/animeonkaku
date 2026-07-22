package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.isCacheComplete
import com.takeya.animeongaku.media.protectedPlaybackUrls
import com.takeya.animeongaku.media.upcomingPlaybackUrls
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreCacheManagerTest {
    @Test
    fun `song only queue is included in upcoming pre-cache urls`() {
        val song = PlayableItem.RelatedSong(
            SongEntity(10, "Song", "Artist", audioUrl = "https://example.com/song.flac")
        )
        val state = NowPlayingState(
            nowPlayingEntries = listOf(
                QueueEntry(1, PlayableItem.Theme(theme(1))),
                QueueEntry(2, song)
            )
        )

        assertEquals(
            listOf("https://example.com/song.flac"),
            upcomingPlaybackUrls(state, maxTracks = 2, activeServerBaseUrl = null)
        )
    }

    @Test
    fun `mixed queue protects theme and related song urls from eviction`() {
        val state = NowPlayingState(
            nowPlayingEntries = listOf(
                QueueEntry(1, PlayableItem.Theme(theme(1))),
                QueueEntry(
                    2,
                    PlayableItem.RelatedSong(
                        SongEntity(10, "Song", "Artist", audioUrl = "https://example.com/song.flac")
                    )
                )
            )
        )

        assertEquals(
            setOf("https://example.com/theme-1.mp3", "https://example.com/song.flac"),
            protectedPlaybackUrls(state, activeServerBaseUrl = null)
        )
    }

    @Test
    fun `partial cached span is not treated as complete`() {
        assertFalse(isCacheComplete(contentLength = 1_000L, cachedBytes = 400L))
    }

    @Test
    fun `complete cached span is treated as complete`() {
        assertTrue(isCacheComplete(contentLength = 1_000L, cachedBytes = 1_000L))
    }

    @Test
    fun `unknown length falls back to key presence`() {
        assertTrue(isCacheComplete(contentLength = -1L, cachedBytes = 1L))
    }

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = null,
        title = "Theme $id",
        artistName = null,
        audioUrl = "https://example.com/theme-$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )
}
