package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.ui.library.MusicRequestUiState
import com.takeya.animeongaku.ui.library.hasReadyMusic
import com.takeya.animeongaku.ui.library.musicRequestActionPresentation
import com.takeya.animeongaku.ui.library.shouldShowRelatedMusicSeeAll
import com.takeya.animeongaku.ui.library.shouldShowMusicRequestAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeDetailDebugMusicTest {
    @Test
    fun `debug action remains visible without themes or library membership`() {
        assertTrue(shouldShowMusicRequestAction(isDebug = true, themeCount = 0, isInLibrary = false))
    }

    @Test
    fun `release action is absent regardless of anime state`() {
        assertFalse(shouldShowMusicRequestAction(isDebug = false, themeCount = 5, isInLibrary = true))
    }

    @Test
    fun `submitting action is disabled and accessible`() {
        val presentation = musicRequestActionPresentation(MusicRequestUiState.Submitting)

        assertEquals("Requesting music", presentation.label)
        assertEquals("Submitting music request", presentation.statusDescription)
        assertFalse(presentation.enabled)
    }

    @Test
    fun `operator state gives concise non-sensitive guidance`() {
        val presentation = musicRequestActionPresentation(MusicRequestUiState.AwaitingOperator(batchCount = 3))

        assertEquals("Needs operator review", presentation.label)
        assertEquals("3 batches requested", presentation.supportingText)
        assertFalse(presentation.enabled)
    }

    @Test
    fun `full size theme audio replaces stale request state with ready state`() {
        val modes = mapOf(
            10L to ThemeModeEntity(themeId = 10L, tvSizeUrl = "/themes/10", fullSizeUrl = "/songs/20")
        )
        val ready = hasReadyMusic(hasRelatedReleases = false, themeModesById = modes)
        val presentation = musicRequestActionPresentation(MusicRequestUiState.AwaitingOperator(batchCount = 1), ready)

        assertTrue(ready)
        assertEquals("Some music is ready", presentation.label)
        assertFalse(presentation.supportingText.orEmpty().contains("batch", ignoreCase = true))
    }

    @Test
    fun `ready catalog dominates idle request action`() {
        val presentation = musicRequestActionPresentation(MusicRequestUiState.Idle, readyMusicAvailable = true)

        assertEquals("Music is ready", presentation.label)
        assertFalse(presentation.enabled)
    }

    @Test
    fun `related music always offers full list entry`() {
        assertFalse(shouldShowRelatedMusicSeeAll(0))
        (1..3).forEach { assertTrue(shouldShowRelatedMusicSeeAll(it)) }
    }

    @Test
    fun `active and terminal states cannot submit another request`() {
        val states = listOf(
            MusicRequestUiState.Queued(2),
            MusicRequestUiState.Searching(2),
            MusicRequestUiState.Downloading(2),
            MusicRequestUiState.Processing(2),
            MusicRequestUiState.AwaitingOperator(2),
            MusicRequestUiState.Completed(2),
            MusicRequestUiState.CompletedWithWarnings(2),
            MusicRequestUiState.TerminalAttention(2)
        )

        states.forEach { state ->
            assertFalse("$state must not POST", musicRequestActionPresentation(state).enabled)
        }
    }

    @Test
    fun `status error retries status while submission error retries POST`() {
        val statusError = musicRequestActionPresentation(
            MusicRequestUiState.StatusError("Could not refresh request status. Try again.")
        )
        val submissionError = musicRequestActionPresentation(
            MusicRequestUiState.SubmissionError("Could not request music. Try again.")
        )

        assertEquals("Retry status", statusError.label)
        assertEquals("Retry music request", submissionError.label)
        assertTrue(statusError.enabled)
        assertTrue(submissionError.enabled)
    }
}
