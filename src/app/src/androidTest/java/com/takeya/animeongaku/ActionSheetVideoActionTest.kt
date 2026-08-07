package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.ui.common.ActionSheet
import com.takeya.animeongaku.ui.common.ActionSheetConfig
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ActionSheetVideoActionTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun approvedBrowseSheetShowsPlayVideoAndInvokesContextStart() {
        var dismissed = 0
        var played = 0
        composeRule.setContent {
            MaterialTheme {
                ActionSheet(
                    config = ActionSheetConfig(
                        title = "Anime context",
                        subtitle = "2 themes",
                        showPlayVideo = true
                    ),
                    onDismiss = { dismissed++ },
                    onPlayVideo = { played++ }
                )
            }
        }

        composeRule.onNodeWithText("Play Video").assertIsDisplayed().performClick()
        composeRule.runOnIdle {
            assertEquals(1, dismissed)
            assertEquals(1, played)
        }
    }

    @Test
    fun unavailableBrowseSheetHasNoVideoOrFullSizeAction() {
        composeRule.setContent {
            MaterialTheme {
                ActionSheet(
                    config = ActionSheetConfig(
                        title = "Offline playlist",
                        subtitle = "2 themes",
                        showPlayVideo = false
                    ),
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithText("Play Video").assertDoesNotExist()
        composeRule.onNodeWithText("Play Full Size").assertDoesNotExist()
    }
}
