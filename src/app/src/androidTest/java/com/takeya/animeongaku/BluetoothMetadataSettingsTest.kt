package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.MediumTest
import com.takeya.animeongaku.media.BluetoothMetadataStyle
import com.takeya.animeongaku.ui.settings.BluetoothMetadataStyleDialog
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@MediumTest
@RunWith(AndroidJUnit4::class)
class BluetoothMetadataSettingsTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun bluetoothDisplayDialogOffersAllStylesAndSelectsOne() {
        var selectedStyle: BluetoothMetadataStyle? = null

        composeRule.setContent {
            MaterialTheme {
                BluetoothMetadataStyleDialog(
                    selectedStyle = BluetoothMetadataStyle.ANIME_THEME,
                    onStyleSelected = { selectedStyle = it },
                    onDismiss = {}
                )
            }
        }

        composeRule.onNodeWithText("Anime and theme").assertIsDisplayed()
        composeRule.onNodeWithText("Anime, theme, and song").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Song and artist").performScrollTo().assertIsDisplayed().performClick()

        composeRule.runOnIdle {
            assertEquals(BluetoothMetadataStyle.SONG_ARTIST, selectedStyle)
        }
    }
}
