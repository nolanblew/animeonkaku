package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.ui.search.executeLatestOnlineSearch
import com.takeya.animeongaku.ui.search.themeModeIdsForSearch
import java.util.concurrent.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class OnlineSearchExecutionTest {
    @Test
    fun `remote-only anime theme IDs are included in mode availability lookup`() {
        val remoteOnly = AnimeThemeEntry(
            animeId = "100",
            themeId = "200",
            title = "Remote Full Theme",
            artist = "Artist",
            audioUrl = "https://server/audio/200",
            videoUrl = null
        )

        assertEquals(
            setOf(10L, 200L),
            themeModeIdsForSearch(
                localThemes = listOf(ThemeEntity(10L, null, "Local", null, "https://server/audio/10", null, false, null)),
                onlineThemes = listOf(remoteOnly)
            )
        )
    }

    @Test
    fun `older non-cooperative search cannot overwrite newer results`() = runTest {
        var currentRequest = 1L
        val olderResult = CompletableDeferred<String>()
        val published = mutableListOf<String>()

        val olderJob = launch {
            executeLatestOnlineSearch(
                isCurrent = { currentRequest == 1L },
                load = {
                    try {
                        olderResult.await()
                    } catch (_: CancellationException) {
                        withContext(NonCancellable) { olderResult.await() }
                    }
                },
                onSuccess = published::add,
                onFailure = { fail("The stale request must not publish an error") }
            )
        }
        runCurrent()

        currentRequest = 2L
        olderJob.cancel()
        executeLatestOnlineSearch(
            isCurrent = { currentRequest == 2L },
            load = { "newer" },
            onSuccess = published::add,
            onFailure = { fail("The current request should succeed") }
        )
        olderResult.complete("older")
        advanceUntilIdle()

        assertEquals(listOf("newer"), published)
    }

    @Test
    fun `cancellation is rethrown instead of presented as search failure`() = runTest {
        val cancellation = CancellationException("superseded")
        var failurePublished = false

        try {
            executeLatestOnlineSearch<String>(
                isCurrent = { true },
                load = { throw cancellation },
                onSuccess = { fail("A canceled search cannot succeed") },
                onFailure = { failurePublished = true }
            )
            fail("Expected cancellation")
        } catch (caught: CancellationException) {
            assertSame(cancellation, caught)
        }

        assertEquals(false, failurePublished)
    }
}
