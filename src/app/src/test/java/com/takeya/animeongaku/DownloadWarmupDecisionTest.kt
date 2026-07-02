package com.takeya.animeongaku

import com.takeya.animeongaku.download.AudioWarmupDecision
import com.takeya.animeongaku.download.audioWarmupDecision
import com.takeya.animeongaku.download.mapWithDownloadParallelism
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class DownloadWarmupDecisionTest {
    @Test
    fun `ready server audio proceeds to download`() {
        assertEquals(AudioWarmupDecision.READY, audioWarmupDecision("READY"))
    }

    @Test
    fun `failed server audio stops the download`() {
        assertEquals(AudioWarmupDecision.FAILED, audioWarmupDecision("FAILED"))
    }

    @Test
    fun `pending states keep waiting for the server cache`() {
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision("MISSING"))
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision("PENDING"))
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision("QUEUED"))
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision("DOWNLOADING"))
    }

    @Test
    fun `unknown states keep waiting rather than hammering the origin`() {
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision("something-new"))
        assertEquals(AudioWarmupDecision.WAIT, audioWarmupDecision(""))
    }

    @Test
    fun `download transfers are capped at six concurrent items`() = runTest {
        val active = AtomicInteger(0)
        val maxActive = AtomicInteger(0)

        mapWithDownloadParallelism((1..18).toList()) {
            val nowActive = active.incrementAndGet()
            maxActive.updateAndGet { current -> maxOf(current, nowActive) }
            delay(100)
            active.decrementAndGet()
        }

        assertEquals(6, maxActive.get())
    }
}
