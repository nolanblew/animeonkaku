package com.takeya.animeongaku

import com.takeya.animeongaku.data.repository.*
import com.takeya.animeongaku.ui.player.ThemeMusicRequestCoordinator
import com.takeya.animeongaku.ui.player.ThemeMusicRequestTarget
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ThemeMusicRequestCoordinatorTest {
    @Test fun `incorrect song is retained before the request can update its catalog mapping`() = runTest {
        val repo = RequestRepo()
        val retained = mutableListOf<Long?>()
        val coordinator = ThemeMusicRequestCoordinator(repo, this) { target ->
            assertTrue(repo.calls.isEmpty())
            retained += target.fullSizeSongId
        }
        coordinator.submit(ThemeMusicRequestTarget("123", 45, "Song", 99), ThemeMusicRequestReason.INCORRECT_FULL_SIZE)
        runCurrent()
        assertEquals(listOf(99L), retained)
        assertEquals(1, repo.calls.size)
    }

    @Test fun `request captures selected song and ignores repeated submission while in flight`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val repo = RequestRepo(gate)
        val coordinator = ThemeMusicRequestCoordinator(repo, this)
        val first = ThemeMusicRequestTarget("123", 45, "First song")
        coordinator.submit(first, ThemeMusicRequestReason.INCORRECT_FULL_SIZE)
        runCurrent()
        coordinator.submit(ThemeMusicRequestTarget("456", 67, "Next song"), ThemeMusicRequestReason.REQUEST_FULL_SIZE)
        gate.complete(Unit)
        runCurrent()
        assertEquals(listOf(Triple("123", 45L, ThemeMusicRequestReason.INCORRECT_FULL_SIZE)), repo.calls)
        assertEquals(first, coordinator.state.value!!.target)
        assertTrue(coordinator.state.value!!.message.contains("manual review"))
        assertFalse(coordinator.state.value!!.busy)
    }

    @Test fun `failed status check retries saved request without submitting another job`() = runTest {
        val repo = RequestRepo()
        val coordinator = ThemeMusicRequestCoordinator(repo, this)
        coordinator.submit(ThemeMusicRequestTarget("123", 45, "Song"), ThemeMusicRequestReason.REQUEST_FULL_SIZE)
        runCurrent()
        repo.failStatus = true
        coordinator.refresh()
        runCurrent()
        assertNotNull(coordinator.state.value!!.error)
        repo.failStatus = false
        coordinator.retry()
        runCurrent()
        assertEquals(1, repo.calls.size)
        assertEquals(listOf("request-1", "request-1"), repo.statusCalls)
        assertNull(coordinator.state.value!!.error)
        assertTrue(coordinator.state.value!!.message.contains("completed"))
    }

    @Test fun `submission failure is visible and retry retains original theme`() = runTest {
        val repo = RequestRepo().apply { failSubmit = true }
        val coordinator = ThemeMusicRequestCoordinator(repo, this)
        val target = ThemeMusicRequestTarget("123", 45, "Song")
        coordinator.submit(target, ThemeMusicRequestReason.INCORRECT_FULL_SIZE)
        runCurrent()
        assertNotNull(coordinator.state.value!!.error)
        repo.failSubmit = false
        coordinator.retry()
        runCurrent()
        assertEquals(target, coordinator.state.value!!.target)
        assertEquals(2, repo.calls.size)
        assertNull(coordinator.state.value!!.error)
    }
}

private class RequestRepo(private val gate: CompletableDeferred<Unit>? = null) : MusicRequestRepository {
    val calls = mutableListOf<Triple<String, Long, ThemeMusicRequestReason>>()
    val statusCalls = mutableListOf<String>()
    var failSubmit = false
    var failStatus = false
    override suspend fun requestTheme(kitsuId: String, themeId: Long, reason: ThemeMusicRequestReason): ThemeMusicRequestResult {
        calls += Triple(kitsuId, themeId, reason)
        gate?.await()
        if (failSubmit) error("network unavailable")
        return ThemeMusicRequestResult(request(), reason == ThemeMusicRequestReason.INCORRECT_FULL_SIZE, false)
    }
    override suspend fun get(requestId: String): MusicRequest {
        statusCalls += requestId
        if (failStatus) error("network unavailable")
        return request().copy(state = MusicRequestState.COMPLETED, active = false)
    }
    override suspend fun create(kitsuId: String): MusicRequest = error("Unexpected anime request")
    override suspend fun latest(kitsuId: String): MusicRequest? = null
    private fun request() = MusicRequest(
        "request-1", "123", state = MusicRequestState.QUEUED, active = true,
        batchCount = 1, fullThemeCount = 1, counts = MusicRequestBatchCounts(queued = 1),
        requiresOperatorAction = false, lastUpdatedAt = "now", pollAfterSeconds = 5
    )
}
