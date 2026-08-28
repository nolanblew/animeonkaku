package com.takeya.animeongaku

import com.takeya.animeongaku.media.playbackAvailabilityChanges
import com.takeya.animeongaku.media.PlaybackAvailabilityChange
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.media.withServerUnavailable
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
    fun `current reachable state refreshes queue when collector starts late`() = runTest {
        val serverReachable = MutableStateFlow(true)
        val changes = mutableListOf<PlaybackAvailabilityChange>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            playbackAvailabilityChanges(serverReachable, MutableSharedFlow())
                .collect(changes::add)
        }

        runCurrent()

        assertEquals(
            listOf(PlaybackAvailabilityChange.ServerReachability(true)),
            changes
        )
        job.cancel()
    }

    @Test
    fun `server loss recovery and download changes each refresh the active queue`() = runTest {
        val serverReachable = MutableStateFlow(false)
        val mediaInvalidations = MutableSharedFlow<Unit>()
        val changes = mutableListOf<PlaybackAvailabilityChange>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            playbackAvailabilityChanges(serverReachable, mediaInvalidations)
                .take(4)
                .collect(changes::add)
        }

        serverReachable.value = true
        runCurrent()
        serverReachable.value = false
        runCurrent()
        mediaInvalidations.emit(Unit)
        runCurrent()

        job.join()
        assertEquals(
            listOf(
                PlaybackAvailabilityChange.ServerReachability(false),
                PlaybackAvailabilityChange.ServerReachability(true),
                PlaybackAvailabilityChange.ServerReachability(false),
                PlaybackAvailabilityChange.MediaInvalidation
            ),
            changes
        )
    }

    @Test
    fun `server loss retains actual mode as static status instead of rebuilding away current item`() {
        val offline = PlaybackState(
            preferredMode = PlaybackMode.FULL_SIZE,
            actualMode = PlaybackMode.TV_SIZE,
            availableModes = setOf(PlaybackMode.TV_SIZE, PlaybackMode.FULL_SIZE, PlaybackMode.VIDEO)
        ).withServerUnavailable()

        assertEquals(PlaybackMode.TV_SIZE, offline.actualMode)
        assertEquals(setOf(PlaybackMode.TV_SIZE), offline.availableModes)
    }
}
