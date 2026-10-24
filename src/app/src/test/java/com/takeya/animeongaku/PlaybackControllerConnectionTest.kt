package com.takeya.animeongaku

import com.google.common.util.concurrent.SettableFuture
import com.takeya.animeongaku.media.PlaybackControllerConnection
import com.takeya.animeongaku.media.launchPlaybackRestoration
import java.io.IOException
import java.util.concurrent.Executor
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackControllerConnectionTest {
    @Test
    fun `background process startup does not bind until activity starts after restoration`() = runTest {
        val harness = Harness(this)
        harness.connection.enable()
        advanceTimeBy(60_000)
        assertEquals(0, harness.attempts)
        harness.connection.setForeground(true)
        assertEquals(1, harness.attempts)
    }

    @Test
    fun `activity start before restoration waits for enable and binds exactly once`() = runTest {
        val harness = Harness(this)
        harness.connection.setForeground(true)
        assertEquals(0, harness.attempts)
        harness.connection.enable()
        harness.connection.enable()
        harness.connection.setForeground(true)
        assertEquals(1, harness.attempts)
    }

    @Test
    fun `synchronous builder failure is reported and retried instead of escaping`() = runTest {
        val harness = Harness(this)
        harness.synchronousFailure = IllegalStateException("Background service start denied")
        harness.start()
        assertEquals(1, harness.failures.size)
        assertEquals(1, harness.attempts)
        harness.synchronousFailure = null
        runCurrent()
        advanceTimeBy(250)
        runCurrent()
        assertEquals(2, harness.attempts)
        harness.futures.last().set("ready")
        assertEquals(listOf("ready"), harness.connected)
    }

    @Test
    fun `async bind failure retries only while foregrounded`() = runTest {
        val harness = Harness(this)
        harness.start()
        harness.futures.last().setException(IOException("Service unavailable"))
        runCurrent()
        harness.connection.setForeground(false)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, harness.attempts)
        harness.connection.setForeground(true)
        assertEquals(2, harness.attempts)
    }

    @Test
    fun `background cancels pending bind and return starts a single fresh attempt`() = runTest {
        val harness = Harness(this)
        harness.start()
        val old = harness.futures.single()
        harness.connection.setForeground(false)
        assertTrue(old.isCancelled)
        assertTrue(harness.failures.isEmpty())
        harness.connection.setForeground(true)
        harness.futures.last().set("new")
        assertEquals(listOf("new"), harness.connected)
        assertEquals(2, harness.attempts)
    }

    @Test
    fun `completed bind callback queued before background cannot replace a newer controller`() = runTest {
        val callbacks = ArrayDeque<Runnable>()
        val harness = Harness(this, Executor { callbacks.add(it) })
        harness.start()
        harness.futures.single().set("old")
        harness.connection.setForeground(false)
        assertEquals(listOf("old"), harness.released)
        harness.connection.setForeground(true)
        harness.futures.last().set("new")
        while (callbacks.isNotEmpty()) callbacks.removeFirst().run()
        assertEquals(listOf("new"), harness.connected)
        assertTrue(harness.failures.isEmpty())
    }

    @Test
    fun `backgrounding a connected controller preserves active playback without release or bind`() = runTest {
        val harness = Harness(this)
        harness.start()
        harness.futures.single().set("playing")
        harness.connection.setForeground(false)
        advanceTimeBy(60_000)
        harness.connection.setForeground(true)
        assertEquals(1, harness.attempts)
        assertTrue(harness.released.isEmpty())
        assertTrue(harness.disconnected.isEmpty())
    }

    @Test
    fun `idle service disconnect in background waits until activity returns`() = runTest {
        val harness = Harness(this)
        harness.start()
        harness.futures.single().set("idle")
        harness.connection.setForeground(false)
        harness.connection.disconnected("idle", IOException("Service stopped"))
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, harness.attempts)
        assertEquals(listOf("idle"), harness.disconnected)
        harness.connection.setForeground(true)
        assertEquals(2, harness.attempts)
    }

    @Test
    fun `external-only service startup permits one local bind without an activity`() = runTest {
        val harness = Harness(this)
        harness.connection.enable()
        harness.connection.setServiceAvailable(true)
        harness.connection.setServiceAvailable(true)
        assertEquals(1, harness.attempts)
        harness.futures.single().set("external")
        assertEquals(listOf("external"), harness.connected)
    }

    @Test
    fun `background bind may finish while an external service is still available`() = runTest {
        val harness = Harness(this)
        harness.start()
        harness.connection.setServiceAvailable(true)
        harness.connection.setForeground(false)
        assertFalse(harness.futures.single().isCancelled)
        harness.futures.single().set("external")
        assertEquals(listOf("external"), harness.connected)
    }

    @Test
    fun `external service stopping cancels pending background bind until activity returns`() = runTest {
        val harness = Harness(this)
        harness.connection.enable()
        harness.connection.setServiceAvailable(true)
        harness.connection.setServiceAvailable(false)
        assertTrue(harness.futures.single().isCancelled)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, harness.attempts)
        harness.connection.setForeground(true)
        harness.futures.last().set("foreground")
        assertEquals(2, harness.attempts)
        assertEquals(listOf("foreground"), harness.connected)
    }

    @Test
    fun `external service stop cancels a scheduled background retry`() = runTest {
        val harness = Harness(this)
        harness.connection.enable()
        harness.connection.setServiceAvailable(true)
        harness.futures.single().setException(IOException("External bind failed"))
        runCurrent()
        harness.connection.setServiceAvailable(false)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, harness.attempts)
        harness.connection.setForeground(true)
        assertEquals(2, harness.attempts)
    }

    @Test
    fun `stopped external service disconnect cannot trigger a background restart`() = runTest {
        val harness = Harness(this)
        harness.connection.enable()
        harness.connection.setServiceAvailable(true)
        harness.futures.single().set("external")
        harness.connection.setServiceAvailable(false)
        harness.connection.disconnected("external", IOException("Service destroyed"))
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(1, harness.attempts)
        assertEquals(listOf("external"), harness.disconnected)
    }

    @Test
    fun `late disconnection from an old controller leaves the new connection intact`() = runTest {
        val harness = Harness(this)
        harness.start()
        harness.futures.single().set("old")
        harness.connection.disconnected("old", IOException("Stopped"))
        runCurrent()
        advanceTimeBy(250)
        runCurrent()
        harness.futures.last().set("new")
        harness.connection.disconnected("old", IOException("Late callback"))
        advanceTimeBy(10_000)
        assertEquals(2, harness.attempts)
        assertEquals(listOf("old"), harness.disconnected)
    }

    @Test
    fun `asynchronous restore failure is handled without publishing controller readiness`() = runTest {
        val failure = IOException("Resolution unavailable")
        var ready = false
        var reported: Exception? = null
        val job = launchPlaybackRestoration(
            restore = { delay(100); throw failure },
            isCurrent = { true },
            onReady = { ready = true },
            onFailure = { reported = it },
        )
        job.join()
        assertSame(failure, reported)
        assertFalse(ready)
    }

    @Test
    fun `cancelled restore cannot publish readiness or trigger a reconnect`() = runTest {
        var ready = false
        var failed = false
        val resolution = CompletableDeferred<Unit>()
        val job = launchPlaybackRestoration(
            restore = { resolution.await() },
            isCurrent = { true },
            onReady = { ready = true },
            onFailure = { failed = true },
        )
        runCurrent()
        job.cancel()
        resolution.complete(Unit)
        job.join()
        assertFalse(ready)
        assertFalse(failed)
    }

    @Test
    fun `obsolete restore completion or failure cannot mutate the replacement controller`() = runTest {
        for (fails in listOf(false, true)) {
            var current = true
            var ready = false
            var reported = false
            val resolution = CompletableDeferred<Unit>()
            val job = launchPlaybackRestoration(
                restore = { resolution.await(); if (fails) throw IOException("Old failure") },
                isCurrent = { current },
                onReady = { ready = true },
                onFailure = { reported = true },
            )
            runCurrent()
            current = false
            resolution.complete(Unit)
            job.join()
            assertFalse(ready)
            assertFalse(reported)
        }
    }

    private class Harness(scope: TestScope, executor: Executor = Executor { it.run() }) {
        var attempts = 0
        var synchronousFailure: Exception? = null
        val futures = mutableListOf<SettableFuture<String>>()
        val connected = mutableListOf<String>()
        val disconnected = mutableListOf<String>()
        val released = mutableListOf<String>()
        val failures = mutableListOf<Throwable>()
        val connection = PlaybackControllerConnection(
            scope = scope.backgroundScope,
            executor = executor,
            connect = {
                attempts++
                synchronousFailure?.let { throw it }
                SettableFuture.create<String>().also(futures::add)
            },
            releaseFuture = { if (!it.cancel(false) && !it.isCancelled) released.add(it.get()) },
            release = { released.add(it) },
            onConnected = { connected.add(it) },
            onDisconnected = { disconnected.add(it) },
            onFailure = { error, _ -> failures.add(error) },
        )

        fun start() {
            connection.enable()
            connection.setForeground(true)
        }
    }
}
