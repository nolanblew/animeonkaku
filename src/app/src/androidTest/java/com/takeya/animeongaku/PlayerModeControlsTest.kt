package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.ui.player.LandscapeVideoOverlay
import com.takeya.animeongaku.ui.player.PlayerModeSelector
import com.takeya.animeongaku.ui.player.PlayerModeUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerModeControlsTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun selectorUsesActualModeAccessibleTargetsAndLiveRetainedIntent() {
        var selected: PlaybackMode? = null
        composeRule.setContent {
            MaterialTheme {
                PlayerModeSelector(
                    state = PlayerModeUiState(
                        visible = true,
                        options = listOf(
                            PlaybackMode.TV_SIZE,
                            PlaybackMode.FULL_SIZE,
                            PlaybackMode.VIDEO
                        ),
                        preferredMode = PlaybackMode.VIDEO,
                        actualMode = PlaybackMode.TV_SIZE,
                        retainedIntentText = "Video preferred · playing TV Size"
                    ),
                    isExpanded = true,
                    onModeSelected = { selected = it }
                )
            }
        }

        val tvMode = composeRule.onNodeWithContentDescription("TV Size playback mode")
        tvMode.assertIsSelected()
        val bounds = tvMode.fetchSemanticsNode().boundsInRoot
        assertTrue(bounds.height >= with(composeRule.density) { 48.dp.toPx() })
        assertTrue(bounds.width >= with(composeRule.density) { 48.dp.toPx() })
        composeRule.onNodeWithContentDescription("Video playback mode")
            .assertIsNotSelected()
            .performClick()
        composeRule.onNodeWithText("Video preferred · playing TV Size")
            .assertIsDisplayed()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Video preferred · playing TV Size"
                )
            )
        composeRule.runOnIdle { assertEquals(PlaybackMode.VIDEO, selected) }
    }

    @Test
    fun collapsedSelectorExposesNoModeActionsOrRetainedIntentSemantics() {
        composeRule.setContent {
            MaterialTheme {
                PlayerModeSelector(
                    state = PlayerModeUiState(
                        visible = true,
                        options = listOf(PlaybackMode.TV_SIZE, PlaybackMode.VIDEO),
                        preferredMode = PlaybackMode.VIDEO,
                        actualMode = PlaybackMode.TV_SIZE,
                        retainedIntentText = "Video preferred · playing TV Size"
                    ),
                    isExpanded = false,
                    onModeSelected = {}
                )
            }
        }

        composeRule.onNodeWithContentDescription("TV Size playback mode").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Video playback mode").assertDoesNotExist()
        composeRule.onNodeWithText("Video preferred · playing TV Size").assertDoesNotExist()
    }

    @Test
    fun fullscreenVideoControlsAreAccessibleAndInvokePlaybackActions() {
        var previous = 0
        var playPause = 0
        var next = 0
        composeRule.setContent {
            MaterialTheme {
                LandscapeVideoOverlay(
                    controller = null,
                    isPlaying = false,
                    isLiked = false,
                    isDisliked = false,
                    onToggleLike = {},
                    onToggleDislike = {},
                    onPrevious = { previous++ },
                    onPlayPause = { playPause++ },
                    onNext = { next++ }
                )
            }
        }

        composeRule.onNodeWithContentDescription("Previous", substring = true).assertIsDisplayed().performClick()
        composeRule.onNodeWithContentDescription("Play or pause", substring = true).assertIsDisplayed().performClick()
        composeRule.onNodeWithContentDescription("Next", substring = true).assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals(1, previous)
            assertEquals(1, playPause)
            assertEquals(1, next)
        }
    }
}
