package com.takeya.animeongaku.ui.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerArtworkRequestPolicyTest {
    @Test
    fun `collapsed mini player keeps constraint sized artwork`() {
        assertFalse(playerArtworkLoadsOriginalSize(progress = 0f))
    }

    @Test
    fun `opening player upgrades artwork to original size`() {
        assertTrue(playerArtworkLoadsOriginalSize(progress = 0.11f))
        assertTrue(playerArtworkLoadsOriginalSize(progress = 1f))
    }
}
