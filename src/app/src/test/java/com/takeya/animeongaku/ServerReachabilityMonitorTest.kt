package com.takeya.animeongaku

import com.takeya.animeongaku.network.serverReachabilityFlow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ServerReachabilityMonitorTest {
    @Test
    fun `one failed probe does not interrupt a healthy server session`() = runTest {
        val networkOnline = MutableStateFlow(true)
        val probeResults = ArrayDeque(listOf(true, false, true))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkOnline = networkOnline,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).collect(observed::add)
        }

        runCurrent()
        advanceTimeBy(100L)
        runCurrent()
        advanceTimeBy(100L)
        runCurrent()
        job.cancel()

        assertEquals(listOf(true), observed)
    }

    @Test
    fun `repeated failed probes still declare the server unavailable`() = runTest {
        val networkOnline = MutableStateFlow(true)
        val probeResults = ArrayDeque(listOf(true, false, false))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkOnline = networkOnline,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).collect(observed::add)
        }

        runCurrent()
        advanceTimeBy(100L)
        runCurrent()
        advanceTimeBy(100L)
        runCurrent()
        job.cancel()

        assertEquals(listOf(true, false), observed)
    }

    @Test
    fun `offline is unavailable and online probes detect server loss and recovery`() = runTest {
        val networkOnline = MutableStateFlow(false)
        val probeResults = ArrayDeque(listOf(true, false, true))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkOnline = networkOnline,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).take(4).toList(observed)
        }

        assertEquals(listOf(false), observed)
        networkOnline.value = true
        runCurrent()
        advanceTimeBy(100L)
        runCurrent()
        advanceTimeBy(100L)
        runCurrent()

        job.join()
        assertEquals(listOf(false, true, false, true), observed)
    }

    @Test
    fun `failed health probe reports server unavailable`() = runTest {
        val available = serverReachabilityFlow(
            networkOnline = MutableStateFlow(true),
            probe = { error("server down") },
            probeIntervalMs = 100L
        ).first()

        assertEquals(false, available)
    }
}
