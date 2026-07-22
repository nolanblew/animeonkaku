package com.takeya.animeongaku

import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackPreferences
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
    }

    @Test
    fun `Full Size and Show OST survive a new preference instance`() {
        val storage = FakeSharedPreferences()
        PlaybackPreferences(storage).apply {
            rememberAudioMode(PlaybackMode.FULL_SIZE)
            showOstsOnHome = false
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
