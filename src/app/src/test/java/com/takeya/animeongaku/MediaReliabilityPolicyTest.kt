package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.buildPlaybackResolutionBatchRequest
import com.takeya.animeongaku.media.controllerConnectionRetryDelayMs
import com.takeya.animeongaku.media.hasUnconsumedPlayRequest
import com.takeya.animeongaku.media.playWhenReadyAfterQueueReplacement
import com.takeya.animeongaku.media.playRequestGenerationAfterPause
import com.takeya.animeongaku.media.playbackPositionPollIntervalMs
import com.takeya.animeongaku.media.shouldClearPlaybackDirtyAfterPersist
import com.takeya.animeongaku.media.shouldPreCacheOnNetwork
import com.takeya.animeongaku.media.shouldSchedulePlaybackTeardownPersist
import com.takeya.animeongaku.media.writeTextAtomically
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RED contracts for audit remediation. These name the deliberately small production seams needed
 * to make controller/lifecycle behavior deterministic without constructing a real MediaController
 * or Android Service in JVM tests.
 */
class MediaReliabilityPolicyTest {
    @Test
    fun `failed controller connection chooses a bounded recoverable retry instead of throwing`() {
        val delayMs = controllerConnectionRetryDelayMs(
            failure = IllegalStateException("Media session unavailable"),
            attempt = 0
        )

        assertTrue(delayMs >= 250L)
        assertTrue(delayMs <= 5_000L)
    }

    @Test
    fun `cancelled controller connection chooses a bounded recoverable retry instead of throwing`() {
        val delayMs = controllerConnectionRetryDelayMs(
            failure = CancellationException("Media session bind cancelled"),
            attempt = 3
        )

        assertTrue(delayMs >= 250L)
        assertTrue(delayMs <= 5_000L)
    }

    @Test
    fun `structural queue rebuild preserves paused intent`() {
        assertFalse(
            playWhenReadyAfterQueueReplacement(
                wasPlaying = false,
                userRequestedPlay = false
            )
        )
    }

    @Test
    fun `structural queue rebuild preserves active playback intent`() {
        assertTrue(
            playWhenReadyAfterQueueReplacement(
                wasPlaying = true,
                userRequestedPlay = false
            )
        )
    }

    @Test
    fun `explicit user play may start a previously paused replacement queue`() {
        assertTrue(
            playWhenReadyAfterQueueReplacement(
                wasPlaying = false,
                userRequestedPlay = true
            )
        )
    }

    @Test
    fun `pause consumes an in-flight play generation but not a later play`() {
        val consumed = playRequestGenerationAfterPause(currentGeneration = 7L)

        assertFalse(hasUnconsumedPlayRequest(currentGeneration = 7L, consumedGeneration = consumed))
        assertTrue(hasUnconsumedPlayRequest(currentGeneration = 8L, consumedGeneration = consumed))
    }

    @Test
    fun `batch resolution request deduplicates all DAO lookup keys for a queue`() {
        val first = QueueEntry(
            queueId = 1,
            item = theme(1, fullSizeSongId = 101)
        )
        val duplicateOccurrence = QueueEntry(
            queueId = 2,
            item = theme(1, fullSizeSongId = 101)
        )
        val second = QueueEntry(
            queueId = 3,
            item = theme(2, fullSizeSongId = 202)
        )

        val request = buildPlaybackResolutionBatchRequest(
            listOf(first, duplicateOccurrence, second)
        )

        assertEquals(setOf(1L, 2L), request.themeIds)
        assertEquals(
            setOf(
                MediaKey.themeTv(1),
                MediaKey.songAudio(101),
                MediaKey.themeTv(2),
                MediaKey.songAudio(202)
            ),
            request.mediaKeys
        )
    }

    @Test
    fun `atomic writer keeps the last complete queue state when temporary write fails`() {
        val directory = Files.createTempDirectory("now-playing-atomic").toFile()
        val target = File(directory, "now_playing_state.json").apply { writeText("last-good") }

        try {
            var thrown = false
            try {
                writeTextAtomically(target) { temporary ->
                    temporary.writeText("partial-new-state")
                    throw IOException("simulated disk failure")
                }
            } catch (_: IOException) {
                thrown = true
            }

            assertTrue(thrown)
            assertEquals("last-good", target.readText())
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun `paused playback has no periodic position polling`() {
        assertEquals(null, playbackPositionPollIntervalMs(isPlaying = false))
    }

    @Test
    fun `active playback position polling does not exceed four wakeups per second`() {
        assertTrue(requireNotNull(playbackPositionPollIntervalMs(isPlaying = true)) >= 250L)
    }

    @Test
    fun `teardown skips a second persistence request when no state changed since debounce save`() {
        assertFalse(shouldSchedulePlaybackTeardownPersist(hasUnsavedState = false))
    }

    @Test
    fun `teardown schedules remaining state persistence without a synchronous lifecycle flush`() {
        assertTrue(shouldSchedulePlaybackTeardownPersist(hasUnsavedState = true))
    }

    @Test
    fun `controller-only state change keeps persistence dirty when an older save finishes`() {
        assertFalse(
            shouldClearPlaybackDirtyAfterPersist(
                persisted = true,
                savedRevision = 11L,
                latestRevision = 12L,
            )
        )
    }

    @Test
    fun `latest controller-only state save clears persistence dirty only after success`() {
        assertTrue(
            shouldClearPlaybackDirtyAfterPersist(
                persisted = true,
                savedRevision = 12L,
                latestRevision = 12L,
            )
        )
        assertFalse(
            shouldClearPlaybackDirtyAfterPersist(
                persisted = false,
                savedRevision = 12L,
                latestRevision = 12L,
            )
        )
    }

    @Test
    fun `wifi only preference prevents precache on metered network`() {
        assertFalse(shouldPreCacheOnNetwork(wifiOnly = true, isUnmetered = false))
    }

    @Test
    fun `wifi only preference allows precache on unmetered network`() {
        assertTrue(shouldPreCacheOnNetwork(wifiOnly = true, isUnmetered = true))
    }

    @Test
    fun `precache remains available on metered network when wifi-only is disabled`() {
        assertTrue(shouldPreCacheOnNetwork(wifiOnly = false, isUnmetered = false))
    }

    private fun theme(id: Long, fullSizeSongId: Long) = ThemeEntity(
        id = id,
        animeId = null,
        title = "Theme $id",
        artistName = "Artist",
        audioUrl = "https://server.example/audio/theme/$id",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    ).let { theme ->
        PlayableItem.Theme(
            theme = theme,
            modeDescriptor = ThemeModeEntity(
                themeId = id,
                tvSizeUrl = theme.audioUrl,
                fullSizeSongId = fullSizeSongId,
                fullSizeUrl = "https://server.example/audio/song/$fullSizeSongId",
                videoUrl = null,
                videoSpoiler = false,
                videoNsfw = false
            )
        )
    }
}
