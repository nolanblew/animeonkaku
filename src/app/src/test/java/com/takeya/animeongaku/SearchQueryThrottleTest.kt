package com.takeya.animeongaku

import com.takeya.animeongaku.ui.search.debouncedDistinctSearchQueries
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchQueryThrottleTest {
    @Test
    fun `rapid typing produces one local-search query after the debounce window`() = runTest {
        val source = MutableSharedFlow<String>()
        val received = mutableListOf<String>()
        val collector = launch {
            debouncedDistinctSearchQueries(source).take(1).toList(received)
        }
        runCurrent()

        source.emit("n")
        source.emit("na")
        source.emit("nar")
        advanceTimeBy(249)
        assertTrue(received.isEmpty())

        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf("nar"), received)
        collector.cancel()
    }

    @Test
    fun `equivalent whitespace is normalized before local search`() = runTest {
        val source = MutableSharedFlow<String>()
        val received = mutableListOf<String>()
        val collector = launch {
            debouncedDistinctSearchQueries(source).take(1).toList(received)
        }
        runCurrent()

        source.emit("  naruto   shippuden  ")
        advanceTimeBy(250)
        runCurrent()

        assertEquals(listOf("naruto shippuden"), received)
        collector.cancel()
    }

    @Test
    fun `clearing search emits immediately while text remains debounced`() = runTest {
        val source = MutableSharedFlow<String>()
        val received = mutableListOf<String>()
        val collector = launch {
            debouncedDistinctSearchQueries(source).take(2).toList(received)
        }
        runCurrent()

        source.emit("naruto")
        advanceTimeBy(250)
        runCurrent()
        assertEquals(listOf("naruto"), received)

        source.emit("   ")
        runCurrent()
        assertEquals(listOf("naruto", ""), received)
        collector.cancel()
    }
}
