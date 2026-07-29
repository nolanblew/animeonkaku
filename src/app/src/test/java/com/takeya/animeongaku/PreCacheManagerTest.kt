package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackResolver
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
                QueueEntry(1, PlayableItem.Theme(theme(1).first)),
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
                QueueEntry(1, PlayableItem.Theme(theme(1).first)),
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
    fun `pre-cache follows the resolver selected full-size URI instead of the legacy theme URI`() {
        val nextTheme = theme(
            id = 2,
            audioUrl = "https://server.example/audio/theme/2",
            modeDescriptor = ThemeModeEntity(
                themeId = 2,
                tvSizeUrl = "https://server.example/audio/theme/2",
                fullSizeSongId = 20,
                fullSizeUrl = "https://server.example/audio/song/20",
                videoUrl = null,
                videoSpoiler = false,
                videoNsfw = false
            )
        )
        val nextEntry = QueueEntry(2, PlayableItem.Theme(nextTheme.first, modeDescriptor = nextTheme.second))
        val state = NowPlayingState(
            nowPlayingEntries = listOf(
                QueueEntry(1, PlayableItem.Theme(theme(1).first)),
                nextEntry
            ),
            currentIndex = 0,
            playbackIntent = PlaybackIntent(rememberedAudioMode = PlaybackMode.FULL_SIZE)
        )

        val resolved = PlaybackResolver().resolve(
            entry = nextEntry,
            intent = state.playbackIntent,
            isOnline = true,
            localMedia = emptyMap()
        )
        val resolvedUri = resolved.uri

        assertEquals("https://server.example/audio/song/20", resolvedUri)
        assertEquals(
            listOf(requireNotNull(resolvedUri)),
            upcomingPlaybackUrls(listOf(resolved), maxTracks = 2)
        )
    }

    @Test
    fun `protected cache keys follow the resolver selected URI for the current full-size track`() {
        val (fullTheme, descriptor) = theme(
            id = 3,
            audioUrl = "https://server.example/audio/theme/3",
            modeDescriptor = ThemeModeEntity(
                themeId = 3,
                tvSizeUrl = "https://server.example/audio/theme/3",
                fullSizeSongId = 30,
                fullSizeUrl = "https://server.example/audio/song/30",
                videoUrl = null,
                videoSpoiler = false,
                videoNsfw = false
            )
        )
        val entry = QueueEntry(3, PlayableItem.Theme(fullTheme, modeDescriptor = descriptor))
        val state = NowPlayingState(
            nowPlayingEntries = listOf(entry),
            playbackIntent = PlaybackIntent(rememberedAudioMode = PlaybackMode.FULL_SIZE)
        )

        val resolved = PlaybackResolver().resolve(
            entry = entry,
            intent = state.playbackIntent,
            isOnline = true,
            localMedia = emptyMap()
        )
        val resolvedUri = resolved.uri

        assertEquals("https://server.example/audio/song/30", resolvedUri)
        assertEquals(
            setOf(requireNotNull(resolvedUri)),
            protectedPlaybackUrls(listOf(resolved))
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

    private fun theme(
        id: Long,
        audioUrl: String = "https://example.com/theme-$id.mp3",
        modeDescriptor: ThemeModeEntity? = null
    ): Pair<ThemeEntity, ThemeModeEntity?> = ThemeEntity(
        id = id,
        animeId = null,
        title = "Theme $id",
        artistName = null,
        audioUrl = audioUrl,
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    ) to modeDescriptor
}
