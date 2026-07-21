package com.takeya.animeongaku

import com.takeya.animeongaku.ui.library.MusicRequestUiState
import com.takeya.animeongaku.ui.library.musicRequestActionPresentation
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
