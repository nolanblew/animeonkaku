package com.takeya.animeongaku

import com.takeya.animeongaku.media.isCacheComplete
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PreCacheManagerTest {
    @Test
    fun `partial cached span is not treated as complete`() {
        assertFalse(isCacheComplete(contentLength = 1_000L, cachedBytes = 400L))
    }

    @Test
    fun `complete cached span is treated as complete`() {
        assertTrue(isCacheComplete(contentLength = 1_000L, cachedBytes = 1_000L))
    }

    @Test
    fun `unknown length falls back to key presence`() {
        assertTrue(isCacheComplete(contentLength = -1L, cachedBytes = 1L))
    }
}
