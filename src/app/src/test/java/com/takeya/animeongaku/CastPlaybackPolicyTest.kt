package com.takeya.animeongaku

import com.takeya.animeongaku.media.cast.castAudioPath
import com.takeya.animeongaku.media.cast.castHandoff
import com.takeya.animeongaku.media.cast.shouldRecordPlaybackStart
import org.junit.Assert.*
import org.junit.Test

class CastPlaybackPolicyTest {
    @Test fun `remote queue reloads do not count the current song as another play`() {
        assertFalse(shouldRecordPlaybackStart(true, true, true))
        assertTrue(shouldRecordPlaybackStart(true, false, true))
        assertTrue(shouldRecordPlaybackStart(true, true, false))
        assertTrue(shouldRecordPlaybackStart(false, true, true))
    }
    @Test fun `downloads cast the same server variant rather than a phone file`() {
        assertEquals("themes/12.mp3", castAudioPath("THEME:12:TV_SIZE"))
        assertEquals("songs/34.mp3", castAudioPath("SONG:34:AUDIO"))
        assertNull(castAudioPath("THEME:12:VIDEO"))
        assertNull(castAudioPath("SONG:../34:AUDIO"))
        assertNull(castAudioPath(null))
    }

    @Test fun `handoff preserves occurrence position and paused state`() {
        val handoff = castHandoff(listOf("100", "101", "102"), "101", 45_000, false, true)
        assertEquals(1, handoff!!.index)
        assertEquals(45_000L, handoff.positionMs)
        assertFalse(handoff.playWhenReady)
    }

    @Test fun `disconnect never starts phone audio unexpectedly`() {
        assertFalse(castHandoff(listOf("100"), "100", 7_000, true, false)!!.playWhenReady)
        assertTrue(castHandoff(listOf("100"), "100", 7_000, true, true)!!.playWhenReady)
        assertNull(castHandoff(emptyList(), null, 0, true, true))
        assertNull(castHandoff(listOf("100"), "gone", 0, true, true))
    }
}
