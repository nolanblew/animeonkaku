package com.takeya.animeongaku

import com.takeya.animeongaku.data.repository.MusicRequest
import com.takeya.animeongaku.data.repository.MusicRequestBatchCounts
import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.MusicRequestState
import com.takeya.animeongaku.ui.library.MusicRequestCoordinator
import com.takeya.animeongaku.ui.library.MusicRequestUiState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MusicRequestCoordinatorTest {
    @Test
    fun `hydration with no durable request becomes idle`() = runTest {
        val repository = FakeMusicRequestRepository(latest = null)
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 1_000)

        coordinator.hydrate("123")
        advanceUntilIdle()

        assertEquals(MusicRequestUiState.Idle, coordinator.state.value)
        assertEquals(listOf("123"), repository.latestCalls)
    }

    @Test
    fun `hydration polls nonterminal request until completion`() = runTest {
        val queued = request(state = MusicRequestState.QUEUED, pollAfterSeconds = 1)
        val completed = request(state = MusicRequestState.COMPLETED, pollAfterSeconds = null)
        val repository = FakeMusicRequestRepository(latest = queued, polls = ArrayDeque(listOf(completed)))
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 5_000)

        coordinator.hydrate("123")
        runCurrent()
        assertTrue(coordinator.state.value is MusicRequestUiState.Queued)
        assertTrue(repository.pollCalls.isEmpty())

        advanceTimeBy(1_000)
        runCurrent()

        assertTrue(coordinator.state.value is MusicRequestUiState.Completed)
        assertEquals(listOf("request-1"), repository.pollCalls)
        advanceTimeBy(30_000)
        assertEquals(1, repository.pollCalls.size)
    }

    @Test
    fun `request prevents concurrent submissions and polls accepted request`() = runTest {
        val searching = request(state = MusicRequestState.SEARCHING, pollAfterSeconds = 1)
        val completed = request(state = MusicRequestState.COMPLETED)
        val repository = FakeMusicRequestRepository(created = searching, polls = ArrayDeque(listOf(completed)))
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 1_000)

        coordinator.request("123")
        coordinator.request("123")
        runCurrent()

        assertEquals(1, repository.createCalls.size)
        assertTrue(coordinator.state.value is MusicRequestUiState.Searching)
        advanceTimeBy(1_000)
        advanceUntilIdle()
        assertTrue(coordinator.state.value is MusicRequestUiState.Completed)
    }

    @Test
    fun `new ready batches and terminal status refresh available catalog`() = runTest {
        val searching = request(
            state = MusicRequestState.SEARCHING,
            pollAfterSeconds = 1,
            counts = MusicRequestBatchCounts(searching = 2)
        )
        val partiallyReady = request(
            state = MusicRequestState.PROCESSING,
            pollAfterSeconds = 1,
            counts = MusicRequestBatchCounts(processing = 1, completed = 1)
        )
        val completed = request(
            state = MusicRequestState.COMPLETED,
            counts = MusicRequestBatchCounts(completed = 2)
        )
        val repository = FakeMusicRequestRepository(
            latest = searching,
            polls = ArrayDeque(listOf(partiallyReady, completed))
        )
        var catalogRefreshes = 0
        val coordinator = MusicRequestCoordinator(
            repository,
            this,
            defaultPollDelayMillis = 1_000,
            onCatalogRefreshNeeded = { catalogRefreshes++ }
        )

        coordinator.hydrate("123")
        runCurrent()
        assertEquals(0, catalogRefreshes)

        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(1, catalogRefreshes)

        advanceTimeBy(1_000)
        advanceUntilIdle()
        assertEquals(2, catalogRefreshes)
        assertTrue(repository.createCalls.isEmpty())
    }

    @Test
    fun `active polling refuses a new POST request`() = runTest {
        val queued = request(state = MusicRequestState.QUEUED, pollAfterSeconds = 10)
        val repository = FakeMusicRequestRepository(latest = queued, created = queued)
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.hydrate("123")
        runCurrent()
        coordinator.request("123")
        runCurrent()

        assertTrue(coordinator.state.value is MusicRequestUiState.Queued)
        assertTrue(repository.createCalls.isEmpty())
    }

    @Test
    fun `submission error is retryable without leaving anime detail`() = runTest {
        val repository = FakeMusicRequestRepository(createError = IllegalStateException("controller offline"))
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.request("123")
        advanceUntilIdle()

        val failed = coordinator.state.value as MusicRequestUiState.SubmissionError
        assertEquals("Could not request music. Try again.", failed.message)

        repository.createError = null
        repository.created = request(state = MusicRequestState.AWAITING_OPERATOR)
        coordinator.request("123")
        runCurrent()

        assertTrue(coordinator.state.value is MusicRequestUiState.AwaitingOperator)
        assertEquals(2, repository.createCalls.size)
    }

    @Test
    fun `cancel stops polling without cancelling server request`() = runTest {
        val repository = FakeMusicRequestRepository(latest = request(state = MusicRequestState.DOWNLOADING))
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 1_000)

        coordinator.hydrate("123")
        runCurrent()
        coordinator.cancel()
        advanceTimeBy(10_000)

        assertTrue(repository.pollCalls.isEmpty())
        assertFalse(repository.cancelWasCalled)
    }

    @Test
    fun `latest status failure retries GET rather than POST`() = runTest {
        val repository = FakeMusicRequestRepository(latestError = IllegalStateException("offline"))
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.hydrate("123")
        advanceUntilIdle()
        assertTrue(coordinator.state.value is MusicRequestUiState.StatusError)

        repository.latestError = null
        repository.latest = request(state = MusicRequestState.COMPLETED)
        coordinator.retryStatus()
        advanceUntilIdle()

        assertTrue(coordinator.state.value is MusicRequestUiState.Completed)
        assertEquals(2, repository.latestCalls.size)
        assertTrue(repository.createCalls.isEmpty())
    }

    @Test
    fun `poll failure retries resource GET rather than POST`() = runTest {
        val queued = request(state = MusicRequestState.QUEUED, pollAfterSeconds = 1)
        val completed = request(state = MusicRequestState.COMPLETED)
        val repository = FakeMusicRequestRepository(
            latest = queued,
            pollError = IllegalStateException("offline")
        )
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.hydrate("123")
        advanceTimeBy(1_000)
        runCurrent()
        assertTrue(coordinator.state.value is MusicRequestUiState.StatusError)

        repository.pollError = null
        repository.polls += completed
        coordinator.retryStatus()
        advanceUntilIdle()

        assertTrue(coordinator.state.value is MusicRequestUiState.Completed)
        assertEquals(listOf("request-1", "request-1"), repository.pollCalls)
        assertTrue(repository.createCalls.isEmpty())
    }

    private fun request(
        state: MusicRequestState,
        pollAfterSeconds: Int? = null,
        counts: MusicRequestBatchCounts = MusicRequestBatchCounts()
    ) = MusicRequest(
        id = "request-1",
        kitsuId = "123",
        state = state,
        batchCount = 3,
        counts = counts,
        requiresOperatorAction = state == MusicRequestState.AWAITING_OPERATOR,
        lastUpdatedAt = "2026-07-21T20:00:00.000Z",
        pollAfterSeconds = pollAfterSeconds
    )
}

private class FakeMusicRequestRepository(
    var latest: MusicRequest? = null,
    var created: MusicRequest? = null,
    val polls: ArrayDeque<MusicRequest> = ArrayDeque(),
    var createError: Exception? = null,
    var latestError: Exception? = null,
    var pollError: Exception? = null
) : MusicRequestRepository {
    val latestCalls = mutableListOf<String>()
    val createCalls = mutableListOf<String>()
    val pollCalls = mutableListOf<String>()
    var cancelWasCalled = false

    override suspend fun latest(kitsuId: String): MusicRequest? {
        latestCalls += kitsuId
        latestError?.let { throw it }
        return latest
    }

    override suspend fun create(kitsuId: String): MusicRequest {
        createCalls += kitsuId
        createError?.let { throw it }
        return checkNotNull(created)
    }

    override suspend fun get(requestId: String): MusicRequest {
        pollCalls += requestId
        pollError?.let { throw it }
        return polls.removeFirst()
    }
}
