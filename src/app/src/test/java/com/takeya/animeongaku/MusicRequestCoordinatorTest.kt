package com.takeya.animeongaku

import com.takeya.animeongaku.data.repository.MusicRequest
import com.takeya.animeongaku.data.repository.MusicRequestBatchCounts
import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.MusicRequestScope
import com.takeya.animeongaku.data.repository.MusicRequestScopeStatus
import com.takeya.animeongaku.data.repository.MusicRequestState
import com.takeya.animeongaku.data.repository.MusicRequestStatus
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
    fun `hydration maps both scopes from one combined status`() = runTest {
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(
                listOf(
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 3),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, eligible = 2, available = 2, missing = 0)
                    )
                )
            )
        )
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.hydrate("123")
        advanceUntilIdle()

        assertEquals(3, coordinator.state.value[MusicRequestScope.FULL_SONGS].missingCount)
        assertEquals(0, coordinator.state.value[MusicRequestScope.EXTRA_MUSIC].missingCount)
        assertEquals(listOf("123"), repository.statusCalls)
    }

    @Test
    fun `active full songs request does not block extra music submission`() = runTest {
        val full = request("full-1", MusicRequestScope.FULL_SONGS, MusicRequestState.SEARCHING, active = true)
        val extra = request("extra-1", MusicRequestScope.EXTRA_MUSIC, MusicRequestState.QUEUED, active = true)
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(
                listOf(
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 2, latest = full),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, eligible = 3, missing = 3)
                    ),
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 2, latest = full),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, eligible = 3, missing = 3, latest = extra)
                    )
                )
            ),
            created = mutableMapOf(MusicRequestScope.EXTRA_MUSIC to extra)
        )
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 10_000)

        coordinator.hydrate("123")
        runCurrent()
        coordinator.request("123", MusicRequestScope.FULL_SONGS)
        coordinator.request("123", MusicRequestScope.EXTRA_MUSIC)
        runCurrent()

        assertEquals(listOf(MusicRequestScope.EXTRA_MUSIC), repository.createCalls.map { it.second })
        assertTrue(coordinator.state.value[MusicRequestScope.FULL_SONGS].progress is MusicRequestUiState.Searching)
        assertTrue(coordinator.state.value[MusicRequestScope.EXTRA_MUSIC].progress is MusicRequestUiState.Queued)
        coordinator.cancel()
    }

    @Test
    fun `active scopes poll their own request ids and refresh combined status and catalog`() = runTest {
        val fullActive = request("full-1", MusicRequestScope.FULL_SONGS, MusicRequestState.SEARCHING, active = true, pollSeconds = 1)
        val extraActive = request("extra-1", MusicRequestScope.EXTRA_MUSIC, MusicRequestState.DOWNLOADING, active = true, pollSeconds = 1)
        val fullDone = request("full-1", MusicRequestScope.FULL_SONGS, MusicRequestState.COMPLETED, active = false)
        val extraWarning = request("extra-1", MusicRequestScope.EXTRA_MUSIC, MusicRequestState.COMPLETED_WITH_WARNINGS, active = false)
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(
                listOf(
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, 4, missing = 2, latest = fullActive),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, 3, missing = 2, latest = extraActive)
                    ),
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, 4, available = 4, missing = 0, latest = fullDone),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, 3, available = 2, missing = 1, latest = extraWarning)
                    )
                )
            ),
            polled = mutableMapOf("full-1" to fullDone, "extra-1" to extraWarning)
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
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(setOf("full-1", "extra-1"), repository.pollCalls.toSet())
        assertEquals(2, repository.pollCalls.size)
        assertTrue(repository.statusCalls.size >= 2)
        assertTrue(catalogRefreshes >= 1)
        coordinator.cancel()
    }

    @Test
    fun `legacy request shown for extra music keeps polling and progress under extra music`() = runTest {
        val legacyActive = request("legacy-1", MusicRequestScope.FULL_SONGS, MusicRequestState.SEARCHING, active = true, pollSeconds = 1)
        val legacyDone = request("legacy-1", MusicRequestScope.FULL_SONGS, MusicRequestState.COMPLETED, active = false)
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(
                listOf(
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 0),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, eligible = 2, missing = 2, latest = legacyActive)
                    ),
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, eligible = 4, missing = 0),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, eligible = 2, missing = 0, latest = legacyDone)
                    )
                )
            ),
            polled = mutableMapOf("legacy-1" to legacyDone)
        )
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 1_000)

        coordinator.hydrate("123")
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()

        assertTrue(coordinator.state.value[MusicRequestScope.EXTRA_MUSIC].progress is MusicRequestUiState.Completed)
        assertTrue(coordinator.state.value[MusicRequestScope.FULL_SONGS].progress is MusicRequestUiState.Idle)
        coordinator.cancel()
    }

    @Test
    fun `rehydration does not create duplicate polling loops`() = runTest {
        val active = request("full-1", MusicRequestScope.FULL_SONGS, MusicRequestState.SEARCHING, active = true, pollSeconds = 1)
        val done = request("full-1", MusicRequestScope.FULL_SONGS, MusicRequestState.COMPLETED, active = false)
        val snapshot = status(
            scopeStatus(MusicRequestScope.FULL_SONGS, 4, missing = 2, latest = active),
            scopeStatus(MusicRequestScope.EXTRA_MUSIC, 0, missing = 0)
        )
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(listOf(snapshot, snapshot, snapshot)),
            polled = mutableMapOf("full-1" to done)
        )
        val coordinator = MusicRequestCoordinator(repository, this, defaultPollDelayMillis = 1_000)

        coordinator.hydrate("123")
        runCurrent()
        coordinator.hydrate("123")
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(listOf("full-1"), repository.pollCalls)
        coordinator.cancel()
    }

    @Test
    fun `terminal missing work can submit again while completed scope stays untouched`() = runTest {
        val failed = request("extra-old", MusicRequestScope.EXTRA_MUSIC, MusicRequestState.FAILED, active = false)
        val retry = request("extra-new", MusicRequestScope.EXTRA_MUSIC, MusicRequestState.QUEUED, active = true)
        val repository = FakeMusicRequestRepository(
            statuses = ArrayDeque(
                listOf(
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, 4, available = 4, missing = 0),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, 3, available = 1, missing = 2, latest = failed)
                    ),
                    status(
                        scopeStatus(MusicRequestScope.FULL_SONGS, 4, available = 4, missing = 0),
                        scopeStatus(MusicRequestScope.EXTRA_MUSIC, 3, available = 1, missing = 2, latest = retry)
                    )
                )
            ),
            created = mutableMapOf(MusicRequestScope.EXTRA_MUSIC to retry)
        )
        val coordinator = MusicRequestCoordinator(repository, this)

        coordinator.hydrate("123")
        advanceUntilIdle()
        coordinator.request("123", MusicRequestScope.EXTRA_MUSIC)
        runCurrent()

        assertEquals(1, repository.createCalls.size)
        assertFalse(coordinator.state.value[MusicRequestScope.FULL_SONGS].active)
        assertTrue(coordinator.state.value[MusicRequestScope.EXTRA_MUSIC].active)
        coordinator.cancel()
    }

    private fun status(vararg scopes: MusicRequestScopeStatus) = MusicRequestStatus("123", scopes.toList())

    private fun scopeStatus(
        scope: MusicRequestScope,
        eligible: Int,
        available: Int = 0,
        missing: Int,
        latest: MusicRequest? = null
    ) = MusicRequestScopeStatus(scope, latest, latest?.active == true, eligible, available, missing)

    private fun request(
        id: String,
        scope: MusicRequestScope,
        state: MusicRequestState,
        active: Boolean,
        pollSeconds: Int? = null
    ) = MusicRequest(
        id = id,
        kitsuId = "123",
        scope = scope,
        state = state,
        active = active,
        batchCount = 1,
        fullThemeCount = if (scope == MusicRequestScope.FULL_SONGS) 4 else 0,
        counts = MusicRequestBatchCounts(),
        requiresOperatorAction = state == MusicRequestState.AWAITING_OPERATOR,
        lastUpdatedAt = "$id-$state",
        pollAfterSeconds = pollSeconds
    )
}

private class FakeMusicRequestRepository(
    val statuses: ArrayDeque<MusicRequestStatus> = ArrayDeque(),
    val created: MutableMap<MusicRequestScope, MusicRequest> = mutableMapOf(),
    val polled: MutableMap<String, MusicRequest> = mutableMapOf()
) : MusicRequestRepository {
    val statusCalls = mutableListOf<String>()
    val createCalls = mutableListOf<Pair<String, MusicRequestScope>>()
    val pollCalls = mutableListOf<String>()

    override suspend fun status(kitsuId: String): MusicRequestStatus {
        statusCalls += kitsuId
        return if (statuses.size > 1) statuses.removeFirst() else statuses.first()
    }

    override suspend fun request(kitsuId: String, scope: MusicRequestScope): MusicRequest {
        createCalls += kitsuId to scope
        return checkNotNull(created[scope])
    }

    override suspend fun get(requestId: String): MusicRequest {
        pollCalls += requestId
        return checkNotNull(polled[requestId])
    }

    override suspend fun create(kitsuId: String): MusicRequest = request(kitsuId, MusicRequestScope.FULL_SONGS)

    override suspend fun latest(kitsuId: String): MusicRequest? = status(kitsuId)[MusicRequestScope.FULL_SONGS].latest
}
