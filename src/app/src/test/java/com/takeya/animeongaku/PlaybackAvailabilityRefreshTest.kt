package com.takeya.animeongaku

import com.takeya.animeongaku.media.playbackAvailabilityChanges
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackAvailabilityRefreshTest {
    @Test
    fun `server loss recovery and download changes each refresh the active queue`() = runTest {
        val serverReachable = MutableStateFlow(false)
        val mediaInvalidations = MutableSharedFlow<Unit>()
        var refreshCount = 0
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            playbackAvailabilityChanges(serverReachable, mediaInvalidations)
                .take(3)
                .collect { refreshCount++ }
        }

        serverReachable.value = true
        runCurrent()
        serverReachable.value = false
        runCurrent()
        mediaInvalidations.emit(Unit)
        runCurrent()

        job.join()
        assertEquals(3, refreshCount)
    }
}
