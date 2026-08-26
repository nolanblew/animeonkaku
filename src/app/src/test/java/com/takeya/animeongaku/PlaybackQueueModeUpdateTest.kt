package com.takeya.animeongaku

import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.PlayableKey
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.PlaybackItemController
import com.takeya.animeongaku.media.PlaybackMediaDescriptor
import com.takeya.animeongaku.media.PlaybackMediaTag
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMediaFingerprint
import com.takeya.animeongaku.media.VideoFallbackSnapshot
import com.takeya.animeongaku.media.VideoFallbackAttemptRegistry
import com.takeya.animeongaku.media.LatestPlaybackQueueSync
import com.takeya.animeongaku.media.PlaybackSource
import com.takeya.animeongaku.media.ResolvedPlaybackItem
import com.takeya.animeongaku.media.replaceModeChangedPlaybackItems
import com.takeya.animeongaku.media.descriptorsAfterStructuralDiff
import com.takeya.animeongaku.media.resolveForCurrentPlaybackSnapshot
import com.takeya.animeongaku.media.toPlaybackMediaDescriptor
import com.takeya.animeongaku.data.local.LoudnessProfile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackQueueModeUpdateTest {
    @Test
    fun `analyzed gain updates queued entries but never steps the current song`() {
        val old = listOf(
            resolved(10, PlaybackMode.TV_SIZE, "https://server/tv/10").toPlaybackMediaDescriptor(),
            resolved(11, PlaybackMode.TV_SIZE, "https://server/tv/11").toPlaybackMediaDescriptor()
        )
        val analyzed = LoudnessProfile(gainDb = -7.0, state = "READY")
        val desired = listOf(
            resolved(10, PlaybackMode.TV_SIZE, "https://server/tv/10").copy(loudness = analyzed).toPlaybackMediaDescriptor(),
            resolved(11, PlaybackMode.TV_SIZE, "https://server/tv/11").copy(loudness = analyzed).toPlaybackMediaDescriptor()
        )
        val player = FakePlaybackItemController(old, currentIndex = 0, playWhenReady = true)

        replaceModeChangedPlaybackItems(player, desired)

        assertEquals(listOf(1), player.replacedIndexes)
        assertEquals(0, player.prepareCalls)
        assertTrue(player.playWhenReady)
    }

    @Test
    fun `Full mode rebuild keeps ids and index starts at zero while paused`() {
        val old = listOf(
            resolved(10, PlaybackMode.TV_SIZE, "https://server/tv/10").toPlaybackMediaDescriptor(),
            resolved(11, PlaybackMode.TV_SIZE, "https://server/tv/11").toPlaybackMediaDescriptor(),
            resolved(12, PlaybackMode.TV_SIZE, "https://server/tv/12").toPlaybackMediaDescriptor()
        )
        val desired = listOf(
            resolved(10, PlaybackMode.FULL_SIZE, "https://server/full/10").toPlaybackMediaDescriptor(),
            resolved(11, PlaybackMode.FULL_SIZE, "https://server/full/11").toPlaybackMediaDescriptor(),
            resolved(12, PlaybackMode.FULL_SIZE, "https://server/full/12").toPlaybackMediaDescriptor()
        )
        val player = FakePlaybackItemController(old, currentIndex = 1, playWhenReady = false)

        replaceModeChangedPlaybackItems(player, desired)

        assertEquals(listOf("10", "11", "12"), player.items.map { it.mediaId })
        assertEquals(1, player.currentIndex)
        assertEquals(listOf(0, 1, 2), player.replacedIndexes)
        assertEquals(listOf(1 to 0L), player.seeks)
        assertFalse(player.playWhenReady)
        assertEquals(1, player.prepareCalls)
    }

    @Test
    fun `video failure replaces only same occurrence with TV and retains playing intent`() {
        val video = resolved(
            queueId = 21,
            actual = PlaybackMode.VIDEO,
            uri = "https://v.animethemes.moe/example.webm",
            preferred = PlaybackMode.VIDEO
        ).toPlaybackMediaDescriptor()
        val next = resolved(22, PlaybackMode.VIDEO, "https://v.animethemes.moe/next.webm", PlaybackMode.VIDEO)
            .toPlaybackMediaDescriptor()
        val tvFallback = resolved(
            queueId = 21,
            actual = PlaybackMode.TV_SIZE,
            uri = "https://server/tv/21",
            preferred = PlaybackMode.VIDEO
        ).toPlaybackMediaDescriptor()
        val player = FakePlaybackItemController(listOf(video, next), currentIndex = 0, playWhenReady = true)

        replaceModeChangedPlaybackItems(player, listOf(tvFallback, next))

        assertEquals(listOf(0), player.replacedIndexes)
        assertEquals(listOf("21", "22"), player.items.map { it.mediaId })
        assertEquals(listOf(0 to 0L), player.seeks)
        assertTrue(player.playWhenReady)
        assertEquals(1, player.prepareCalls)
    }

    @Test
    fun `add and remove combined with Full switch replaces retained occurrences`() {
        val previous = listOf(
            resolved(10, PlaybackMode.TV_SIZE, "https://server/tv/10").toPlaybackMediaDescriptor(),
            resolved(11, PlaybackMode.TV_SIZE, "https://server/tv/11").toPlaybackMediaDescriptor(),
            resolved(12, PlaybackMode.TV_SIZE, "https://server/tv/12").toPlaybackMediaDescriptor()
        )
        val desired = listOf(
            resolved(10, PlaybackMode.FULL_SIZE, "https://server/full/10").toPlaybackMediaDescriptor(),
            resolved(12, PlaybackMode.FULL_SIZE, "https://server/full/12").toPlaybackMediaDescriptor(),
            resolved(13, PlaybackMode.FULL_SIZE, "https://server/full/13").toPlaybackMediaDescriptor()
        )
        val postStructuralDiff = descriptorsAfterStructuralDiff(previous, desired)
        val player = FakePlaybackItemController(postStructuralDiff, currentIndex = 1, playWhenReady = false)

        replaceModeChangedPlaybackItems(player, desired)

        assertEquals(listOf("10", "12", "13"), player.items.map { it.mediaId })
        assertEquals(listOf(0, 1), player.replacedIndexes)
        assertEquals(listOf(1 to 0L), player.seeks)
        assertFalse(player.playWhenReady)
    }

    @Test
    fun `add and remove combined with Video switch replaces retained occurrences`() {
        val previous = listOf(
            resolved(30, PlaybackMode.TV_SIZE, "https://server/tv/30").toPlaybackMediaDescriptor(),
            resolved(31, PlaybackMode.TV_SIZE, "https://server/tv/31").toPlaybackMediaDescriptor(),
            resolved(32, PlaybackMode.TV_SIZE, "https://server/tv/32").toPlaybackMediaDescriptor()
        )
        val desired = listOf(
            resolved(
                30,
                PlaybackMode.VIDEO,
                "https://v.animethemes.moe/30.webm",
                PlaybackMode.VIDEO
            ).toPlaybackMediaDescriptor(),
            resolved(
                32,
                PlaybackMode.VIDEO,
                "https://v.animethemes.moe/32.webm",
                PlaybackMode.VIDEO
            ).toPlaybackMediaDescriptor(),
            resolved(
                33,
                PlaybackMode.VIDEO,
                "https://v.animethemes.moe/33.webm",
                PlaybackMode.VIDEO
            ).toPlaybackMediaDescriptor()
        )
        val postStructuralDiff = descriptorsAfterStructuralDiff(previous, desired)
        val player = FakePlaybackItemController(postStructuralDiff, currentIndex = 0, playWhenReady = true)

        replaceModeChangedPlaybackItems(player, desired)

        assertEquals(listOf("30", "32", "33"), player.items.map { it.mediaId })
        assertEquals(listOf(0, 1), player.replacedIndexes)
        assertEquals(listOf(0 to 0L), player.seeks)
        assertTrue(player.playWhenReady)
    }

    @Test
    fun `delayed video fallback is discarded after mode switch`() = runTest {
        val video = fallbackSnapshot(queueVersion = 4, queueId = 21, mode = PlaybackMode.VIDEO)
        var current = video
        val resolutionStarted = CompletableDeferred<Unit>()
        val allowResolution = CompletableDeferred<Unit>()

        val result = async {
            resolveForCurrentPlaybackSnapshot(video, currentSnapshot = { current }) {
                resolutionStarted.complete(Unit)
                allowResolution.await()
                "tv-fallback"
            }
        }
        resolutionStarted.await()
        current = fallbackSnapshot(queueVersion = 5, queueId = 21, mode = PlaybackMode.FULL_SIZE)
        allowResolution.complete(Unit)

        assertEquals(null, result.await())
    }

    @Test
    fun `delayed video fallback is discarded after context replacement`() = runTest {
        val video = fallbackSnapshot(queueVersion = 8, queueId = 21, mode = PlaybackMode.VIDEO)
        var current = video
        val resolutionStarted = CompletableDeferred<Unit>()
        val allowResolution = CompletableDeferred<Unit>()

        val result = async {
            resolveForCurrentPlaybackSnapshot(video, currentSnapshot = { current }) {
                resolutionStarted.complete(Unit)
                allowResolution.await()
                "tv-fallback"
            }
        }
        resolutionStarted.await()
        current = fallbackSnapshot(queueVersion = 9, queueId = 99, mode = PlaybackMode.TV_SIZE)
        allowResolution.complete(Unit)

        assertEquals(null, result.await())
    }

    @Test
    fun `competing queue resolution commits only newest generation`() = runTest {
        val sync = LatestPlaybackQueueSync()
        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val commits = mutableListOf<String>()

        val first = launch {
            sync.runLatest(
                resolve = {
                    firstStarted.complete(Unit)
                    releaseFirst.await()
                    "stale"
                },
                commit = commits::add
            )
        }
        firstStarted.await()
        sync.runLatest(resolve = { "newest" }, commit = commits::add)
        releaseFirst.complete(Unit)
        first.join()

        assertEquals(listOf("newest"), commits)
    }

    @Test
    fun `structural queue mutation invalidates an older full resolution`() = runTest {
        val sync = LatestPlaybackQueueSync()
        val resolutionStarted = CompletableDeferred<Unit>()
        val allowResolution = CompletableDeferred<Unit>()
        val commits = mutableListOf<String>()

        val stale = launch {
            sync.runLatest(
                resolve = {
                    resolutionStarted.complete(Unit)
                    allowResolution.await()
                    "stale"
                },
                commit = commits::add
            )
        }
        resolutionStarted.await()
        sync.invalidate()
        allowResolution.complete(Unit)
        stale.join()

        assertTrue(commits.isEmpty())
    }

    @Test
    fun `failed fallback attempt releases occurrence for later retry`() {
        val attempts = VideoFallbackAttemptRegistry()

        assertTrue(attempts.tryStart(21))
        assertFalse(attempts.tryStart(21))
        attempts.finish(21)
        assertTrue(attempts.tryStart(21))
    }

    private fun fallbackSnapshot(
        queueVersion: Long,
        queueId: Long,
        mode: PlaybackMode
    ) = VideoFallbackSnapshot(
        queueVersion = queueVersion,
        intent = PlaybackIntent(sessionOverride = mode),
        currentMedia = PlaybackMediaFingerprint(
            mediaId = queueId.toString(),
            uri = "https://media/$queueId/${mode.name}",
            tag = PlaybackMediaTag(
                playableKey = PlayableKey(PlayableKind.THEME, queueId),
                preferredMode = mode,
                actualMode = mode,
                source = if (mode == PlaybackMode.VIDEO) {
                    PlaybackSource.DIRECT_VIDEO
                } else {
                    PlaybackSource.SERVER_AUDIO
                }
            )
        )
    )

    private fun resolved(
        queueId: Long,
        actual: PlaybackMode,
        uri: String,
        preferred: PlaybackMode = actual
    ) = ResolvedPlaybackItem(
        queueId = queueId,
        playableKey = PlayableKey(PlayableKind.THEME, queueId),
        preferredMode = preferred,
        actualMode = actual,
        uri = uri,
        mediaKey = if (actual == PlaybackMode.VIDEO) null else MediaKey.themeTv(queueId),
        source = if (actual == PlaybackMode.VIDEO) PlaybackSource.DIRECT_VIDEO else PlaybackSource.SERVER_AUDIO,
        availableModes = setOf(actual),
        retainedIntentReason = null,
        title = "Theme $queueId",
        artist = null,
        animeOrRelease = "Anime",
        artworkUrl = null,
        albumTitle = null,
        animeTitle = "Anime"
    )

    private class FakePlaybackItemController(
        initialItems: List<PlaybackMediaDescriptor>,
        override var currentIndex: Int,
        override var playWhenReady: Boolean
    ) : PlaybackItemController {
        override val items = initialItems.toMutableList()
        val replacedIndexes = mutableListOf<Int>()
        val seeks = mutableListOf<Pair<Int, Long>>()
        var prepareCalls = 0

        override fun replaceMediaItem(index: Int, item: PlaybackMediaDescriptor) {
            replacedIndexes += index
            items[index] = item
        }

        override fun seekTo(index: Int, positionMs: Long) {
            currentIndex = index
            seeks += index to positionMs
        }

        override fun prepare() {
            prepareCalls++
        }
    }
}
