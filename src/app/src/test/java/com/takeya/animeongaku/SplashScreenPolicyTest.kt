package com.takeya.animeongaku

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SplashScreenPolicyTest {
    @Test
    fun `ready startup does not wait for an artificial splash minimum`() {
        assertFalse(
            shouldKeepSplashScreen(
                startupReady = true,
                elapsedMs = 0L,
                maxWaitMs = 1_500L
            )
        )
    }

    @Test
    fun `slow startup is bounded by the splash maximum`() {
        assertTrue(
            shouldKeepSplashScreen(
                startupReady = false,
                elapsedMs = 1_499L,
                maxWaitMs = 1_500L
            )
        )
        assertFalse(
            shouldKeepSplashScreen(
                startupReady = false,
                elapsedMs = 1_500L,
                maxWaitMs = 1_500L
            )
        )
    }
}
