package com.takeya.animeongaku

import android.content.res.Configuration
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.media.RetainedIntentReason
import com.takeya.animeongaku.ui.player.ModeSelectionDecision
import com.takeya.animeongaku.ui.player.VideoContentWarning
import com.takeya.animeongaku.ui.player.derivePlayerModeUiState
import com.takeya.animeongaku.ui.player.PLAYER_ARTWORK_MAX_DP
import com.takeya.animeongaku.ui.player.PLAYER_ARTWORK_MIN_DP
import com.takeya.animeongaku.ui.player.PLAYER_CONTENT_MARGIN_DP
import com.takeya.animeongaku.ui.player.PLAYER_STACK_BELOW_ART_DP
import com.takeya.animeongaku.ui.player.expandedPlayerArtworkSize
import com.takeya.animeongaku.ui.player.isFullscreenVideo
import com.takeya.animeongaku.ui.player.showsModeChip
import com.takeya.animeongaku.ui.player.videoControlsAutoHideDelayMillis
import com.takeya.animeongaku.ui.player.VideoModeSessionTracker
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerModeUiStateTest {
    @Test
    fun `related songs never expose the Theme mode selector`() {
        val state = derivePlayerModeUiState(
            isTheme = false,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.RELATED_AUDIO,
                actualMode = PlaybackMode.RELATED_AUDIO,
                availableModes = setOf(PlaybackMode.RELATED_AUDIO)
            )
        )

        assertFalse(state.visible)
        assertTrue(state.options.isEmpty())
    }

    @Test
    fun `Theme modes are ordered and unavailable Video is omitted`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.TV_SIZE,
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.FULL_SIZE, PlaybackMode.TV_SIZE)
            )
        )

        assertEquals(listOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE), state.options)
        assertEquals(PlaybackMode.TV_SIZE, state.actualMode)
    }

    @Test
    fun `a single available mode offers no chooser but two or more do`() {
        val tvOnly = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.TV_SIZE,
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE)
            )
        )

        // The state is still "visible" — the mode is known — but a chooser with
        // one choice is not a control, so the Now Playing eyebrow row omits it.
        assertTrue(tvOnly.visible)
        assertFalse(tvOnly.showsModeChip())

        val switchable = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.TV_SIZE,
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE)
            )
        )

        assertTrue(switchable.showsModeChip())
    }

    @Test
    fun `related songs never offer the mode chooser`() {
        val state = derivePlayerModeUiState(
            isTheme = false,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.RELATED_AUDIO,
                actualMode = PlaybackMode.RELATED_AUDIO,
                availableModes = setOf(PlaybackMode.RELATED_AUDIO)
            )
        )

        assertFalse(state.showsModeChip())
    }

    @Test
    fun `retained preference describes preferred and actual but actual remains selected`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                preferredMode = PlaybackMode.FULL_SIZE,
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE),
                retainedIntentReason = RetainedIntentReason.PREFERRED_MODE_UNAVAILABLE
            )
        )

        assertEquals(PlaybackMode.TV_SIZE, state.actualMode)
        assertEquals("Full Size preferred · playing TV Size", state.retainedIntentText)
    }

    @Test
    fun `safe Video selection applies immediately`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO)
            )
        )

        assertEquals(
            ModeSelectionDecision.Apply(PlaybackMode.VIDEO),
            state.selectionDecision(PlaybackMode.VIDEO)
        )
        assertNull(state.videoContentWarning)
    }

    @Test
    fun `spoiler and nsfw Video selection requires explicit confirmation`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO),
                videoSpoiler = true,
                videoNsfw = true
            )
        )

        assertEquals(
            ModeSelectionDecision.Confirm(
                PlaybackMode.VIDEO,
                VideoContentWarning(spoiler = true, nsfw = true)
            ),
            state.selectionDecision(PlaybackMode.VIDEO)
        )
        assertEquals("This video is marked as a spoiler and NSFW.", state.videoContentWarning?.message)
    }

    @Test
    fun `unavailable mode selection is ignored`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE)
            )
        )

        assertEquals(ModeSelectionDecision.Ignore, state.selectionDecision(PlaybackMode.VIDEO))
    }

    @Test
    fun `mode metadata from the previous queue entry is hidden during transition`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            currentQueueId = 22L,
            playbackState = PlaybackState(
                queueId = 21L,
                actualMode = PlaybackMode.VIDEO,
                availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO)
            )
        )

        assertFalse(state.visible)
        assertTrue(state.options.isEmpty())
    }

    @Test
    fun `Video is fullscreen only when expanded in landscape`() {
        assertTrue(isFullscreenVideo(Configuration.ORIENTATION_LANDSCAPE, isVideo = true, isExpanded = true))
        assertFalse(isFullscreenVideo(Configuration.ORIENTATION_PORTRAIT, isVideo = true, isExpanded = true))
        assertFalse(isFullscreenVideo(Configuration.ORIENTATION_LANDSCAPE, isVideo = false, isExpanded = true))
        assertFalse(isFullscreenVideo(Configuration.ORIENTATION_LANDSCAPE, isVideo = true, isExpanded = false))
    }

    @Test
    fun `expanded artwork yields to whichever of width or control stack binds first`() {
        val margin = (PLAYER_CONTENT_MARGIN_DP * 2).dp
        val roomy = (PLAYER_STACK_BELOW_ART_DP + 500).dp

        // Given plenty of height, the seek bar margin binds and the artwork's edges land
        // exactly where the seek bar's do.
        assertEquals(360.dp - margin, expandedPlayerArtworkSize(360.dp, roomy))
        assertEquals(411.dp - margin, expandedPlayerArtworkSize(411.dp, roomy))

        // On a real phone window the control stack binds first, so the artwork gives up
        // width to keep the reaction row off the Up Next card.
        val short = (PLAYER_STACK_BELOW_ART_DP + 300).dp
        assertEquals(300.dp, expandedPlayerArtworkSize(411.dp, short))

        // A tablet hits the absolute cap rather than swallowing the control stack.
        assertEquals(PLAYER_ARTWORK_MAX_DP.dp, expandedPlayerArtworkSize(800.dp, roomy))

        // A very short window still leaves recognisable artwork.
        assertEquals(PLAYER_ARTWORK_MIN_DP.dp, expandedPlayerArtworkSize(411.dp, 100.dp))
    }

    @Test
    fun `video controls use recommended timeout when accessibility is inactive`() {
        assertEquals(
            9_000L,
            videoControlsAutoHideDelayMillis(
                isPlaying = true,
                controlsVisible = true,
                touchExplorationEnabled = false,
                controlsFocused = false,
                recommendedTimeoutMillis = 9_000L
            )
        )
    }

    @Test
    fun `video controls never auto hide during touch exploration or focus`() {
        assertNull(
            videoControlsAutoHideDelayMillis(
                isPlaying = true,
                controlsVisible = true,
                touchExplorationEnabled = true,
                controlsFocused = false,
                recommendedTimeoutMillis = 9_000L
            )
        )
        assertNull(
            videoControlsAutoHideDelayMillis(
                isPlaying = true,
                controlsVisible = true,
                touchExplorationEnabled = false,
                controlsFocused = true,
                recommendedTimeoutMillis = 9_000L
            )
        )
    }

    @Test
    fun `leaving Video restores prior audio mode and pre-video play state`() {
        val tracker = VideoModeSessionTracker()
        tracker.begin(
            queueId = 41L,
            videoQueueVersion = 8L,
            priorAudioMode = PlaybackMode.FULL_SIZE,
            wasAudioPlaying = true
        )

        val exit = tracker.consumeExit(
            currentQueueId = 41L,
            currentQueueVersion = 8L,
            videoRequested = true
        )

        assertEquals(PlaybackMode.FULL_SIZE, exit?.audioMode)
        assertTrue(exit?.resumePlayback == true)
    }

    @Test
    fun `leaving paused-audio Video session restores audio paused`() {
        val tracker = VideoModeSessionTracker()
        tracker.begin(7L, 3L, PlaybackMode.TV_SIZE, wasAudioPlaying = false)

        val exit = tracker.consumeExit(7L, 3L, videoRequested = true)

        assertEquals(PlaybackMode.TV_SIZE, exit?.audioMode)
        assertFalse(exit?.resumePlayback == true)
    }

    @Test
    fun `intervening media or mode change prevents stale Video exit restoration`() {
        val tracker = VideoModeSessionTracker()
        tracker.begin(41L, 8L, PlaybackMode.FULL_SIZE, wasAudioPlaying = true)
        assertNull(tracker.consumeExit(42L, 9L, videoRequested = true))

        tracker.begin(41L, 8L, PlaybackMode.FULL_SIZE, wasAudioPlaying = true)
        assertNull(tracker.consumeExit(41L, 9L, videoRequested = true))

        tracker.begin(41L, 8L, PlaybackMode.FULL_SIZE, wasAudioPlaying = true)
        assertNull(tracker.consumeExit(41L, 8L, videoRequested = false))
    }
}
