package com.takeya.animeongaku

import com.takeya.animeongaku.network.serverReachabilityFlow
import com.takeya.animeongaku.network.NetworkAvailability
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
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
    fun `cold start keeps online playback available while first probe is pending`() = runTest {
        val pending = kotlinx.coroutines.CompletableDeferred<Boolean>()

        val first = serverReachabilityFlow(
            networkAvailability = MutableStateFlow(NetworkAvailability(0L, true)),
            probe = { pending.await() },
            probeIntervalMs = 100L,
            initialReachableHint = true
        ).first()

        assertEquals(
            com.takeya.animeongaku.network.ServerReachabilityState(true, 0L, false),
            first
        )
    }

    @Test
    fun `one failed probe does not interrupt a healthy server session`() = runTest {
        val network = MutableStateFlow(NetworkAvailability(0L, true))
        val probeResults = ArrayDeque(listOf(true, false, true))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkAvailability = network,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).filter { it.verifiedForNetwork }
                .map { it.reachable }
                .distinctUntilChanged()
                .collect(observed::add)
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
        val network = MutableStateFlow(NetworkAvailability(0L, true))
        val probeResults = ArrayDeque(listOf(true, false, false))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkAvailability = network,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).filter { it.verifiedForNetwork }
                .map { it.reachable }
                .distinctUntilChanged()
                .collect(observed::add)
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
        val network = MutableStateFlow(NetworkAvailability(0L, false))
        val probeResults = ArrayDeque(listOf(true, false, false, true))
        val observed = mutableListOf<Boolean>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkAvailability = network,
                probe = { probeResults.removeFirst() },
                probeIntervalMs = 100L
            ).filter { it.verifiedForNetwork }
                .map { it.reachable }
                .distinctUntilChanged()
                .take(4)
                .toList(observed)
        }

        assertEquals(listOf(false), observed)
        network.value = NetworkAvailability(1L, true)
        runCurrent()
        advanceTimeBy(100L)
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
            networkAvailability = MutableStateFlow(NetworkAvailability(0L, true)),
            probe = { error("server down") },
            probeIntervalMs = 100L
        ).filter { it.verifiedForNetwork }.first().reachable

        assertEquals(false, available)
    }

    @Test
    fun `connected network handoff probes again even while online stays true`() = runTest {
        val network = MutableStateFlow(NetworkAvailability(0L, true))
        val probedGenerations = mutableListOf<Long>()
        val states = mutableListOf<com.takeya.animeongaku.network.ServerReachabilityState>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            serverReachabilityFlow(
                networkAvailability = network,
                probe = {
                    probedGenerations += network.value.generation
                    true
                },
                probeIntervalMs = 1_000L
            ).collect(states::add)
        }

        runCurrent()
        network.value = NetworkAvailability(1L, true)
        runCurrent()
        job.cancel()

        assertEquals(listOf(0L, 1L), probedGenerations)
        assertEquals(
            listOf(0L, 1L),
            states.filter { it.reachable && it.verifiedForNetwork }.map { it.networkGeneration }
        )
    }
}
