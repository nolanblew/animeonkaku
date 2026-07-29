package com.takeya.animeongaku

import com.takeya.animeongaku.download.downloadProgressToPersist
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DownloadProgressPolicyTest {
    @Test
    fun `download progress only persists when the displayed percentage changes`() {
        assertNull(downloadProgressToPersist(lastPersistedPercent = 42, nextPercent = 42, isFinal = false))
        assertEquals(43, downloadProgressToPersist(lastPersistedPercent = 42, nextPercent = 43, isFinal = false))
    }

    @Test
    fun `download progress always persists the terminal percentage`() {
        assertEquals(100, downloadProgressToPersist(lastPersistedPercent = 100, nextPercent = 100, isFinal = true))
    }
}
