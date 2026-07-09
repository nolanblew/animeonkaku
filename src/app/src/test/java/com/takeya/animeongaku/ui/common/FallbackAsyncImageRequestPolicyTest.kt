package com.takeya.animeongaku.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FallbackAsyncImageRequestPolicyTest {
    @Test
    fun `recreated image starts at the last successful fallback for the same url group`() {
        val urls = listOf(
            "https://ongaku.local/v1/media/images/anime/1/cover",
            "https://images.example/fallback.jpg"
        )

        fallbackAsyncImageSuccessCache.clear()
        fallbackAsyncImageSuccessCache.recordSuccess(urls, index = 1)

        assertEquals(1, fallbackAsyncImageInitialIndex(urls))
    }

    @Test
    fun `remembered fallback failure still retries every other url`() {
        val urls = listOf(
            "https://ongaku.local/v1/media/images/anime/1/cover",
            "https://images.example/fallback.jpg",
            "https://images.example/last.jpg"
        )
        fallbackAsyncImageSuccessCache.clear()
        fallbackAsyncImageSuccessCache.recordSuccess(urls, index = 1)

        assertEquals(listOf(1, 0, 2), fallbackAsyncImageAttemptOrder(urls))
    }

    @Test
    fun `first artwork request uses constraint size by default`() {
        val policy = fallbackAsyncImageRequestPolicy(loadOriginalSize = false)

        assertFalse(policy.useOriginalSize)
    }

    @Test
    fun `fallback artwork request uses constraint size by default`() {
        val policy = fallbackAsyncImageRequestPolicy(loadOriginalSize = false)

        assertFalse(policy.useOriginalSize)
    }

    @Test
    fun `original size loading remains opt in`() {
        val policy = fallbackAsyncImageRequestPolicy(loadOriginalSize = true)

        assertTrue(policy.useOriginalSize)
    }
}
