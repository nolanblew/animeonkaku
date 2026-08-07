package com.takeya.animeongaku

import com.takeya.animeongaku.data.repository.MusicRequestScope
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import com.takeya.animeongaku.ui.library.MusicRequestScopeUiState
import com.takeya.animeongaku.ui.library.MusicRequestScreenState
import com.takeya.animeongaku.ui.library.MusicRequestUiState
import com.takeya.animeongaku.ui.library.musicRequestActionPresentation
import com.takeya.animeongaku.ui.library.musicRequestActionSheetActions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeDetailDebugMusicTest {
    @Test
    fun `full songs action is hidden without eligible OP or ED themes`() {
        val presentation = musicRequestActionPresentation(
            scopeState(MusicRequestScope.FULL_SONGS, eligible = 0, missing = 0)
        )

        assertFalse(presentation.visible)
    }

    @Test
    fun `completed full songs action is hidden when nothing is missing`() {
        val presentation = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.FULL_SONGS,
                eligible = 4,
                available = 4,
                missing = 0,
                progress = MusicRequestUiState.Completed(batchCount = 1, fullThemeCount = 4)
            )
        )

        assertFalse(presentation.visible)
    }

    @Test
    fun `extra music action is hidden when ineligible or complete`() {
        assertFalse(
            musicRequestActionPresentation(
                scopeState(MusicRequestScope.EXTRA_MUSIC, eligible = 0, missing = 0)
            ).visible
        )
        assertFalse(
            musicRequestActionPresentation(
                scopeState(
                    MusicRequestScope.EXTRA_MUSIC,
                    eligible = 3,
                    available = 3,
                    missing = 0,
                    progress = MusicRequestUiState.CompletedWithWarnings(1)
                )
            ).visible
        )
    }

    @Test
    fun `loading and active actions stay visible disabled with explicit state`() {
        val loading = musicRequestActionPresentation(
            MusicRequestScopeUiState.loading(MusicRequestScope.FULL_SONGS)
        )
        val active = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.EXTRA_MUSIC,
                eligible = 3,
                missing = 2,
                active = true,
                progress = MusicRequestUiState.Downloading(batchCount = 2)
            )
        )

        assertTrue(loading.visible)
        assertFalse(loading.enabled)
        assertEquals("Loading request status", loading.supportingText)
        assertTrue(active.visible)
        assertFalse(active.enabled)
        assertEquals("Downloads in progress", active.supportingText)
    }

    @Test
    fun `status failure remains scoped and retryable while operator work stays disabled`() {
        val statusError = musicRequestActionPresentation(
            MusicRequestScopeUiState.loading(MusicRequestScope.FULL_SONGS).copy(
                progress = MusicRequestUiState.StatusError("Could not load request status. Try again.")
            )
        )
        val operator = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.EXTRA_MUSIC,
                eligible = 3,
                missing = 2,
                active = true,
                progress = MusicRequestUiState.AwaitingOperator(1)
            )
        )

        assertEquals("Retry status", statusError.label)
        assertEquals("Could not load request status. Try again.", statusError.supportingText)
        assertTrue(statusError.enabled)
        assertEquals("Operator review required", operator.supportingText)
        assertFalse(operator.enabled)
    }

    @Test
    fun `requestable scopes are enabled independently`() {
        val full = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.FULL_SONGS,
                eligible = 4,
                missing = 2,
                active = true,
                progress = MusicRequestUiState.Searching(1)
            )
        )
        val extra = musicRequestActionPresentation(
            scopeState(MusicRequestScope.EXTRA_MUSIC, eligible = 3, missing = 3)
        )

        assertFalse(full.enabled)
        assertTrue(extra.enabled)
        assertEquals("Request Extra Music", extra.label)
    }

    @Test
    fun `warning or failed terminal request with missing work is retryable`() {
        val warning = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.EXTRA_MUSIC,
                eligible = 4,
                available = 2,
                missing = 2,
                progress = MusicRequestUiState.CompletedWithWarnings(1)
            )
        )
        val failed = musicRequestActionPresentation(
            scopeState(
                MusicRequestScope.FULL_SONGS,
                eligible = 4,
                missing = 1,
                progress = MusicRequestUiState.TerminalAttention(1)
            )
        )

        assertTrue(warning.enabled)
        assertEquals("Retry Extra Music", warning.label)
        assertTrue(failed.enabled)
        assertEquals("Retry Full Songs", failed.label)
    }

    @Test
    fun `anime and song action sheet seam exposes both actions in production state`() {
        val state = MusicRequestScreenState.of(
            scopeState(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 4),
            scopeState(MusicRequestScope.EXTRA_MUSIC, eligible = 2, missing = 2)
        )
        val actions = musicRequestActionSheetActions(state)
        val animeSheet = ActionSheetConfig("Anime", "4 themes", customActions = actions)
        val songSheet = ActionSheetConfig("OP1", "Song", customActions = actions)

        assertEquals(listOf("Request Full Songs", "Request Extra Music"), animeSheet.customActions.map { it.label })
        assertEquals(animeSheet.customActions, songSheet.customActions)
    }

    private fun scopeState(
        scope: MusicRequestScope,
        eligible: Int,
        available: Int = 0,
        missing: Int,
        active: Boolean = false,
        progress: MusicRequestUiState = MusicRequestUiState.Idle
    ) = MusicRequestScopeUiState(
        scope = scope,
        progress = progress,
        active = active,
        eligibleCount = eligible,
        availableCount = available,
        missingCount = missing,
        statusLoaded = true
    )
}
