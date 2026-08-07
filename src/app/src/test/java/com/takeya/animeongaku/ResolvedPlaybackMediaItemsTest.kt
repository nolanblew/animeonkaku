package com.takeya.animeongaku

import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableKey
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.PlaybackMediaExtras
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackSource
import com.takeya.animeongaku.media.ResolvedPlaybackItem
import com.takeya.animeongaku.media.RetainedIntentReason
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.media.withResolvedPlayback
import com.takeya.animeongaku.media.toPlaybackMediaDescriptor
import org.junit.Assert.assertEquals
import org.junit.Test

class ResolvedPlaybackMediaItemsTest {
    @Test
    fun `resolved Theme media item keeps occurrence identity and actual mode extras`() {
        val resolved = resolvedTheme(
            queueId = 73,
            preferred = PlaybackMode.VIDEO,
            actual = PlaybackMode.TV_SIZE,
            uri = "https://server.test/v1/media/audio/7"
        )

        val item = resolved.toPlaybackMediaDescriptor()

        assertEquals("73", item.mediaId)
        assertEquals("https://server.test/v1/media/audio/7", item.uri)
        assertEquals("THEME", item.values[PlaybackMediaExtras.PLAYABLE_KIND])
        assertEquals(7L, item.values[PlaybackMediaExtras.PLAYABLE_ID])
        assertEquals("VIDEO", item.values[PlaybackMediaExtras.PREFERRED_MODE])
        assertEquals("TV_SIZE", item.values[PlaybackMediaExtras.ACTUAL_MODE])
    }

    @Test
    fun `UI mode state is sourced from resolver result by queue identity rather than MediaItem tag`() {
        val resolved = resolvedTheme(
            queueId = 73,
            preferred = PlaybackMode.VIDEO,
            actual = PlaybackMode.TV_SIZE,
            uri = "https://server.test/v1/media/audio/7"
        )

        val state = PlaybackState().withResolvedPlayback(73L, mapOf(73L to resolved)[73L])

        assertEquals(73L, state.queueId)
        assertEquals(PlaybackMode.VIDEO, state.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, state.actualMode)
        assertEquals(setOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO), state.availableModes)
        assertEquals(RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE, state.retainedIntentReason)
        assertEquals(true, state.videoSpoiler)
        assertEquals(true, state.videoNsfw)
    }

    @Test
    fun `Related Audio metadata retains release and anime context`() {
        val resolved = ResolvedPlaybackItem(
            queueId = 91,
            playableKey = PlayableKey(PlayableKind.SONG, 55),
            preferredMode = PlaybackMode.RELATED_AUDIO,
            actualMode = PlaybackMode.RELATED_AUDIO,
            uri = "https://server.test/v1/media/audio/song/55",
            mediaKey = MediaKey.songAudio(55),
            source = PlaybackSource.SERVER_AUDIO,
            availableModes = setOf(PlaybackMode.RELATED_AUDIO),
            retainedIntentReason = null,
            title = "Suite",
            artist = "Composer",
            animeOrRelease = "Example Anime",
            artworkUrl = null,
            albumTitle = "Original Soundtrack",
            animeTitle = "Example Anime"
        )

        val item = resolved.toPlaybackMediaDescriptor()

        assertEquals("Original Soundtrack", item.albumTitle)
        assertEquals(
            "Example Anime",
            item.values[PlaybackMediaExtras.ANIME_TITLE]
        )
        assertEquals("RELATED_AUDIO", item.values[PlaybackMediaExtras.ACTUAL_MODE])
    }

    private fun resolvedTheme(
        queueId: Long,
        preferred: PlaybackMode,
        actual: PlaybackMode,
        uri: String
    ) = ResolvedPlaybackItem(
        queueId = queueId,
        playableKey = PlayableKey(PlayableKind.THEME, 7),
        preferredMode = preferred,
        actualMode = actual,
        uri = uri,
        mediaKey = MediaKey.themeTv(7),
        source = PlaybackSource.SERVER_AUDIO,
        availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO),
        retainedIntentReason = RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE,
        title = "Opening",
        artist = "Artist",
        animeOrRelease = "Example Anime",
        artworkUrl = null,
        albumTitle = null,
        animeTitle = "Example Anime",
        videoSpoiler = true,
        videoNsfw = true
    )
}
