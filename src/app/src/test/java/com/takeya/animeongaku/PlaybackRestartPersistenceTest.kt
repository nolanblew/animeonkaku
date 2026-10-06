package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PersistedNowPlayingState
import com.takeya.animeongaku.media.PlaybackStartupRestoration
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.RestoredQueueState
import com.takeya.animeongaku.media.playbackPositionCheckpoints
import com.takeya.animeongaku.media.playbackProgressForPersistence
import com.takeya.animeongaku.media.restorePersistedQueueState
import com.takeya.animeongaku.media.toPersistedState
import com.takeya.animeongaku.media.writeTextAtomically
import java.nio.file.Files
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class, kotlinx.coroutines.FlowPreview::class)
class PlaybackRestartPersistenceTest {
    @Test
    fun `slow startup finishes restoring before persistence or service initialization`() = runTest {
        var queue = NowPlayingState()
        var saved: RestoredQueueState? = RestoredQueueState(savedQueue(), 42_000L, 2)
        var reads = 0
        val startup = PlaybackStartupRestoration(
            currentQueue = { queue },
            load = { reads++; delay(2_000L); saved },
            apply = { queue = it.nowPlayingState },
        )
        val controller = async {
            startup.await()
            // This models the first persistence write; previously the initial empty state
            // deleted the file after 500 ms, while restoration was still doing Room I/O.
            saved = if (queue.nowPlayingEntries.isEmpty()) null else saved
        }
        val service = async { startup.await(); queue.currentEntry?.queueId }

        advanceTimeBy(1_000L)
        runCurrent()
        assertFalse(controller.isCompleted)
        assertFalse(service.isCompleted)
        assertEquals(42_000L, saved?.positionMs)
        advanceTimeBy(1_000L)
        runCurrent()

        controller.await()
        assertEquals(102L, service.await())
        assertEquals(savedQueue(), queue)
        assertEquals(1, reads)
    }

    @Test
    fun `new playback during startup wins over the saved queue`() = runTest {
        var queue = NowPlayingState()
        val loaded = CompletableDeferred<RestoredQueueState?>()
        val startup = PlaybackStartupRestoration({ queue }, { loaded.await() }, { queue = it.nowPlayingState })
        val job = async { startup.await() }
        runCurrent()
        val newQueue = savedQueue().copy(contextLabel = "New playback")
        queue = newQueue
        loaded.complete(RestoredQueueState(savedQueue(), 42_000L, 2))
        job.await()

        assertEquals(newQueue, queue)
    }

    @Test
    fun `clearing playback during startup cannot resurrect the saved queue`() = runTest {
        var queue = NowPlayingState()
        val loaded = CompletableDeferred<RestoredQueueState?>()
        val startup = PlaybackStartupRestoration({ queue }, { loaded.await() }, { queue = it.nowPlayingState })
        val job = async { startup.await() }
        runCurrent()
        queue = NowPlayingState(queueVersion = 2)
        loaded.complete(RestoredQueueState(savedQueue(), 42_000L, 2))
        job.await()

        assertTrue(queue.nowPlayingEntries.isEmpty())
        assertEquals(2L, queue.queueVersion)
    }

    @Test
    fun `continuous playback checkpoints pass debounce and stop when paused`() = runTest {
        val playing = MutableStateFlow(false)
        val positions = mutableListOf<Long>()
        val job = backgroundScope.launch {
            playbackPositionCheckpoints(playing).debounce(500L).collect {
                positions += testScheduler.currentTime
            }
        }
        runCurrent()
        advanceTimeBy(10_000L)
        assertTrue(positions.isEmpty())
        playing.value = true
        runCurrent()
        advanceTimeBy(10_501L)
        runCurrent()
        assertEquals(listOf(15_500L, 20_500L), positions)
        playing.value = false
        runCurrent()
        advanceTimeBy(30_000L)
        runCurrent()
        assertEquals(2, positions.size)
        job.cancel()
    }

    @Test
    fun `file survives restart with shuffled duplicates history insertion identity and position`() {
        val directory = Files.createTempDirectory("playback-restart").toFile()
        try {
            val file = directory.resolve("now_playing_state.json")
            val adapter = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
                .adapter(PersistedNowPlayingState::class.java)
            val persisted = savedQueue().toPersistedState(42_000L, 2).copy(
                ownerKitsuUserId = "user", ownerServerBaseUrl = "https://server"
            )
            writeTextAtomically(file) { it.writeText(adapter.toJson(persisted)) }
            val fromDisk = adapter.fromJson(file.readText())!!
            val restored = restorePersistedQueueState(
                fromDisk, emptyMap(), emptyMap(), emptyMap(), emptyMap(), emptyMap()
            )!!

            assertEquals(listOf(101L, 102L, 103L), restored.nowPlayingEntries.map { it.queueId })
            assertEquals(listOf(1L, 1L, 2L), restored.nowPlaying.map { it.id })
            assertEquals(102L, restored.currentEntry?.queueId)
            assertEquals(listOf(101L), restored.historyEntries.map { it.queueId })
            assertEquals(listOf(103L), restored.playNextEntryIds)
            assertEquals(listOf(102L), restored.addedToQueueEntryIds)
            assertTrue(restored.isShuffled)
            assertEquals(setOf(0, 1), restored.playedIndices)
            assertEquals(42_000L, fromDisk.positionMs)
            assertEquals(2, fromDisk.repeatMode)
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun `cached progress belongs to the exact duplicate occurrence`() {
        val queue = savedQueue()
        val oldOccurrence = PlaybackState(queueId = 101L, positionMs = 90_000L, repeatMode = 2)
        assertEquals(0L, playbackProgressForPersistence(queue, oldOccurrence).positionMs)
        val currentOccurrence = oldOccurrence.copy(queueId = 102L, positionMs = 42_000L)
        assertEquals(42_000L, playbackProgressForPersistence(queue, currentOccurrence).positionMs)
        assertEquals(2, playbackProgressForPersistence(queue, currentOccurrence).repeatMode)
    }

    private fun savedQueue(): NowPlayingState {
        val duplicate = ThemeEntity(1, null, "Duplicate", null, "https://server/theme/1", null, false, null)
        val entries = listOf(
            QueueEntry(101, duplicate), QueueEntry(102, duplicate),
            QueueEntry(103, duplicate.copy(id = 2)),
        )
        return NowPlayingState(
            originalQueueEntries = entries, nowPlayingEntries = entries, currentIndex = 1,
            historyEntries = entries.take(1), playNextEntryIds = listOf(103),
            addedToQueueEntryIds = listOf(102), playedIndices = setOf(0, 1), isShuffled = true,
            contextLabel = "Saved queue", queueVersion = 7,
        )
    }
}
