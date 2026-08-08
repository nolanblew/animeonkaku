package com.takeya.animeongaku

import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.media.BluetoothMetadataStyle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackPreferencesTest {
    @Test
    fun `defaults to TV Size and shows OSTs`() {
        val preferences = PlaybackPreferences(FakeSharedPreferences())
        assertEquals(PlaybackMode.TV_SIZE, preferences.rememberedAudioMode)
        assertTrue(preferences.showOstsOnHome)
        assertEquals(BluetoothMetadataStyle.ANIME_THEME, preferences.bluetoothMetadataStyle)
    }

    @Test
    fun `Bluetooth metadata style survives a new preference instance`() {
        val storage = FakeSharedPreferences()
        PlaybackPreferences(storage).bluetoothMetadataStyle = BluetoothMetadataStyle.COMBINED

        val restarted = PlaybackPreferences(storage)

        assertEquals(BluetoothMetadataStyle.COMBINED, restarted.bluetoothMetadataStyle)
        assertEquals(BluetoothMetadataStyle.COMBINED, restarted.bluetoothMetadataStyleFlow.value)
    }

    @Test
    fun `Full Size and Show OST survive a new preference instance`() {
        val storage = FakeSharedPreferences()
        PlaybackPreferences(storage).apply {
            rememberAudioMode(PlaybackMode.FULL_SIZE)
            showOstsOnHome = false
            assertFalse(showOstsOnHomeFlow.value)
        }

        val restarted = PlaybackPreferences(storage)
        assertEquals(PlaybackMode.FULL_SIZE, restarted.rememberedAudioMode)
        assertFalse(restarted.showOstsOnHome)
    }

    @Test
    fun `Video is session only and never overwrites remembered audio`() {
        val storage = FakeSharedPreferences()
        val preferences = PlaybackPreferences(storage)
        preferences.rememberAudioMode(PlaybackMode.FULL_SIZE)
        preferences.rememberAudioMode(PlaybackMode.VIDEO)

        assertEquals(PlaybackMode.FULL_SIZE, PlaybackPreferences(storage).rememberedAudioMode)
    }
}
