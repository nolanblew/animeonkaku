package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
import com.takeya.animeongaku.data.remote.OngakuFullSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuThemeMediaModesDto
import com.takeya.animeongaku.data.remote.OngakuTvSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuVideoModeDto
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackVariantHydrationKey
import com.takeya.animeongaku.media.PlaybackVariantMetadataStore
import com.takeya.animeongaku.media.PlaybackVariantTarget
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.collectPlaybackVariantHydration
import com.takeya.animeongaku.media.currentPlaybackVariantTarget
import com.takeya.animeongaku.media.playbackVariantHydrationKeys
import com.takeya.animeongaku.network.ServerReachabilityState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackVariantHydratorTest {
    @Test
    fun `first queue song is a hydration target`() {
        val anime = anime("123")
        val entry = QueueEntry(7L, PlayableItem.Theme(theme(10L), anime))

        val target = currentPlaybackVariantTarget(
            NowPlayingState(nowPlayingEntries = listOf(entry), currentIndex = 0)
        )

        assertEquals(PlaybackVariantTarget(7L, 10L, "123"), target)
    }

    @Test
    fun `transient failure retries and succeeds without a track or network change`() = runTest {
        val key = PlaybackVariantHydrationKey(PlaybackVariantTarget(1L, 10L, "123"), 4L)
        val attempts = mutableListOf<PlaybackVariantTarget>()
        val results = ArrayDeque(listOf(false, true))
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            collectPlaybackVariantHydration(
                keys = flowOf(key),
                refresh = {
                    attempts += it
                    results.removeFirst()
                },
                failureRetryDelaysMs = listOf(100L),
                successfulRefreshIntervalMs = 1_000L
            )
        }

        runCurrent()
        assertEquals(1, attempts.size)
        advanceTimeBy(100L)
        runCurrent()

        assertEquals(listOf(key.target, key.target), attempts)
        job.cancel()
    }

    @Test
    fun `track change cancels stale hydration before starting current track`() = runTest {
        val first = PlaybackVariantHydrationKey(PlaybackVariantTarget(1L, 10L, "old"), 2L)
        val second = PlaybackVariantHydrationKey(PlaybackVariantTarget(2L, 20L, "new"), 2L)
        val keys = MutableStateFlow<PlaybackVariantHydrationKey?>(first)
        val started = mutableListOf<Long>()
        val cancelled = mutableListOf<Long>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            collectPlaybackVariantHydration(
                keys = keys,
                refresh = { target ->
                    started += target.queueId
                    if (target.queueId == first.target.queueId) {
                        try {
                            awaitCancellation()
                        } finally {
                            cancelled += target.queueId
                        }
                    }
                    true
                },
                failureRetryDelaysMs = listOf(100L),
                successfulRefreshIntervalMs = 1_000L
            )
        }

        runCurrent()
        keys.value = second
        runCurrent()

        assertEquals(listOf(1L, 2L), started)
        assertEquals(listOf(1L), cancelled)
        job.cancel()
    }

    @Test
    fun `successful hydration refreshes slowly for a newly imported variant`() = runTest {
        val target = PlaybackVariantTarget(1L, 10L, "123")
        var attempts = 0
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            collectPlaybackVariantHydration(
                keys = flowOf(PlaybackVariantHydrationKey(target, 1L)),
                refresh = { attempts++; true },
                failureRetryDelaysMs = listOf(100L),
                successfulRefreshIntervalMs = 1_000L
            )
        }

        runCurrent()
        assertEquals(1, attempts)
        advanceTimeBy(999L)
        runCurrent()
        assertEquals(1, attempts)
        advanceTimeBy(1L)
        runCurrent()
        assertEquals(2, attempts)
        job.cancel()
    }

    @Test
    fun `optimistic reachability waits for verification and network generation rehydrates`() = runTest {
        val state = MutableStateFlow(nowPlayingState(queueId = 1L, themeId = 10L, kitsuId = "123"))
        val reachability = MutableStateFlow(ServerReachabilityState(true, 1L, verifiedForNetwork = false))
        val keys = mutableListOf<PlaybackVariantHydrationKey?>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            playbackVariantHydrationKeys(state, reachability).collect(keys::add)
        }

        runCurrent()
        assertEquals(listOf(null), keys)
        reachability.value = ServerReachabilityState(true, 1L, verifiedForNetwork = true)
        runCurrent()
        reachability.value = ServerReachabilityState(true, 2L, verifiedForNetwork = false)
        runCurrent()
        reachability.value = ServerReachabilityState(true, 2L, verifiedForNetwork = true)
        runCurrent()

        assertEquals(listOf<Long?>(null, 1L, null, 2L), keys.map { it?.networkGeneration })
        job.cancel()
    }

    @Test
    fun `metadata store writes matching full size and video descriptor`() = runTest {
        val writes = mutableListOf<List<ThemeModeEntity>>()
        val store = PlaybackVariantMetadataStore(
            fetchAnime = { animeResponse(themeDto(id = 10L)) },
            upsertModes = { writes += it },
            serverBaseUrl = { "https://server.example/base/" }
        )

        val refreshed = store.refresh(PlaybackVariantTarget(1L, 10L, "123"))

        assertTrue(refreshed)
        val mode = writes.single().single()
        assertEquals("https://server.example/base/v1/media/audio/10", mode.tvSizeUrl)
        assertEquals("https://server.example/base/v1/media/songs/99/audio", mode.fullSizeUrl)
        assertEquals(99L, mode.fullSizeSongId)
        assertEquals("https://video.example/10.webm", mode.videoUrl)
    }

    @Test
    fun `metadata store does not write missing theme or failed request as absence`() = runTest {
        val missingWrites = mutableListOf<List<ThemeModeEntity>>()
        val missingStore = PlaybackVariantMetadataStore(
            fetchAnime = { animeResponse(themeDto(id = 11L)) },
            upsertModes = { missingWrites += it },
            serverBaseUrl = { "https://server.example/" }
        )

        assertFalse(missingStore.refresh(PlaybackVariantTarget(1L, 10L, "123")))
        assertTrue(missingWrites.isEmpty())

        val failedWrites = mutableListOf<List<ThemeModeEntity>>()
        val failedStore = PlaybackVariantMetadataStore(
            fetchAnime = { throw java.io.IOException("handoff") },
            upsertModes = { failedWrites += it },
            serverBaseUrl = { "https://server.example/" }
        )

        val failed = runCatching {
            failedStore.refresh(PlaybackVariantTarget(1L, 10L, "123"))
        }
        assertTrue(failed.isFailure)
        assertTrue(failedWrites.isEmpty())
    }

    private fun anime(kitsuId: String) = AnimeEntity(
        kitsuId = kitsuId,
        animeThemesId = 100L,
        title = "Anime",
        thumbnailUrl = null,
        coverUrl = null,
        syncedAt = 0L
    )

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = 100L,
        title = "Theme",
        artistName = null,
        audioUrl = "/v1/media/audio/$id",
        videoUrl = null,
        isDownloaded = true,
        localFilePath = "/local/$id"
    )

    private fun nowPlayingState(queueId: Long, themeId: Long, kitsuId: String): NowPlayingState {
        val anime = anime(kitsuId)
        return NowPlayingState(
            nowPlayingEntries = listOf(QueueEntry(queueId, PlayableItem.Theme(theme(themeId), anime))),
            currentIndex = 0
        )
    }

    private fun animeResponse(theme: OngakuThemeDto) = OngakuAnimeDetailResponse(
        anime = OngakuAnimeDto(
            kitsuId = "123",
            animeThemesId = 100L,
            title = "Anime",
            titleEn = null,
            titleRomaji = null,
            titleJa = null,
            posterUrl = null,
            coverUrl = null,
            watchingStatus = null,
            subtype = null,
            startDate = null,
            endDate = null,
            episodeCount = null,
            ageRating = null,
            averageRating = null,
            userRating = null,
            libraryUpdatedAt = null,
            slug = null,
            genres = emptyList(),
            updatedAt = 1L,
            deleted = false
        ),
        themes = listOf(theme)
    )

    private fun themeDto(id: Long) = OngakuThemeDto(
        id = id,
        animeThemesAnimeId = 100L,
        kitsuAnimeIds = listOf("123"),
        title = "Theme",
        themeType = "OP1",
        artists = emptyList(),
        audioUrl = "/v1/media/audio/$id",
        videoUrl = "https://video.example/$id.webm",
        audioState = "READY",
        durationSeconds = 90,
        fileSize = 1_000L,
        mediaModes = OngakuThemeMediaModesDto(
            tvSize = OngakuTvSizeModeDto("/v1/media/audio/$id", 90, 1_000L),
            fullSize = OngakuFullSizeModeDto(99L, "/v1/media/songs/99/audio", 240, 2_000L, 200L),
            video = OngakuVideoModeDto("https://video.example/$id.webm", "video/webm")
        ),
        updatedAt = 1L,
        deleted = false
    )
}
