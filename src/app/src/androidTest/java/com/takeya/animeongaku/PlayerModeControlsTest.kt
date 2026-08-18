package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.ui.player.LandscapeVideoOverlay
import com.takeya.animeongaku.ui.player.PlayerModeChip
import com.takeya.animeongaku.ui.player.PlayerModeUiState
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayerModeControlsTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun chipShowsActualModeKeepsAnAccessibleTargetAndAnnouncesRetainedIntent() {
        var selected: PlaybackMode? = null
        composeRule.setContent {
            MaterialTheme {
                PlayerModeChip(
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
                    onModeSelected = { selected = it }
                )
            }
        }

        // Collapsed, the chip reports only the current mode — the alternatives
        // are not on screen competing for attention.
        val chip = composeRule.onNodeWithContentDescription("Playback mode: TV Size")
        chip.assertIsDisplayed()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Video preferred · playing TV Size"
                )
            )
        composeRule.onNodeWithContentDescription("Video playback mode").assertDoesNotExist()

        // The compact chip still exposes an accessible interactive boundary.
        chip.assertHeightIsAtLeast(48.dp)

        chip.performClick()

        composeRule.onNodeWithContentDescription("TV Size playback mode").assertIsSelected()
        composeRule.onNodeWithContentDescription("Video playback mode")
            .assertIsNotSelected()
            .performClick()
        composeRule.runOnIdle { assertEquals(PlaybackMode.VIDEO, selected) }
    }

    @Test
    fun singleModeIsShownAsNonInteractiveStatus() {
        composeRule.setContent {
            MaterialTheme {
                PlayerModeChip(
                    state = PlayerModeUiState(
                        visible = true,
                        options = listOf(PlaybackMode.TV_SIZE),
                        preferredMode = PlaybackMode.TV_SIZE,
                        actualMode = PlaybackMode.TV_SIZE
                    ),
                    onModeSelected = {}
                )
            }
        }

        composeRule.onNodeWithContentDescription("Playback mode: TV Size")
            .assertIsDisplayed()
            .assertHasNoClickAction()
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
