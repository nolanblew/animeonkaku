package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.ui.common.PlaylistPlaybackSettingsSheet
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlaylistPlaybackSettingsSheetTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun sheetExposesPlaylistModeAndOverrideWithoutPuttingThemInMainContent() {
        var selectedMode: String? = null
        var overrideValue: Boolean? = null
        composeRule.setContent {
            MaterialTheme {
                PlaylistPlaybackSettingsSheet(
                    selectedMode = "TV_SIZE",
                    overrideUserPreference = false,
                    onModeSelected = { selectedMode = it },
                    onOverrideChanged = { overrideValue = it },
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithText("Playlist settings").assertIsDisplayed()
        composeRule.onNodeWithText("Full Size").assertIsDisplayed().performClick()
        composeRule.onNodeWithContentDescription("Override song preferences").performClick()

        composeRule.runOnIdle {
            assertEquals("FULL_SIZE", selectedMode)
            assertEquals(true, overrideValue)
        }
    }
}
