package com.takeya.animeongaku

import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.ui.player.ModeSelectionDecision
import com.takeya.animeongaku.ui.player.derivePlayerModeUiState
import org.junit.Assert.assertEquals
import org.junit.Test

class DislikedModeSelectionTest {
    @Test
    fun `a disliked available mode is indicated but still manually selectable`() {
        val state = derivePlayerModeUiState(
            isTheme = true,
            playbackState = PlaybackState(
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE),
                dislikedModes = setOf(PlaybackMode.FULL_SIZE)
            )
        )
        assertEquals(setOf(PlaybackMode.FULL_SIZE), state.dislikedModes)
        assertEquals(
            ModeSelectionDecision.Apply(PlaybackMode.FULL_SIZE),
            state.selectionDecision(PlaybackMode.FULL_SIZE)
        )
        assertEquals(ModeSelectionDecision.Ignore, state.selectionDecision(PlaybackMode.VIDEO))
    }
}
