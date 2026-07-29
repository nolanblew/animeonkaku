package com.takeya.animeongaku

import com.takeya.animeongaku.activeRefreshIntervalMs
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveRefreshPolicyTest {
    @Test
    fun `foreground library refresh is measured in minutes not seconds`() {
        val interval = activeRefreshIntervalMs()

        assertTrue("foreground refresh should wait at least five minutes", interval >= 5 * 60 * 1_000L)
        assertTrue("foreground refresh should converge within fifteen minutes", interval <= 15 * 60 * 1_000L)
    }
}
