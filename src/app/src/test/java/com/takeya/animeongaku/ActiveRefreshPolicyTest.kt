package com.takeya.animeongaku

import com.takeya.animeongaku.activeRefreshIntervalMs
import com.takeya.animeongaku.warmResumePullIntervalMs
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveRefreshPolicyTest {
    @Test
    fun `foreground library refresh checks for server deltas within one minute`() {
        val interval = activeRefreshIntervalMs()

        assertTrue("foreground refresh should not poll more often than every 30 seconds", interval >= 30 * 1_000L)
        assertTrue("foreground refresh should converge within one minute", interval <= 60 * 1_000L)
    }

    @Test
    fun `warm resume bypasses the previous pull throttle`() {
        assertTrue("warm resume should request a pull immediately", warmResumePullIntervalMs() == 0L)
    }
}
