package com.takeya.animeongaku

import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuAudioRequestResponse
import com.takeya.animeongaku.data.remote.OngakuChangesResponse
import com.takeya.animeongaku.data.remote.OngakuLibraryResponse
import com.takeya.animeongaku.data.remote.OngakuLoginRequest
import com.takeya.animeongaku.data.remote.OngakuLoginResponse
import com.takeya.animeongaku.data.remote.OngakuManualAnimeRequest
import com.takeya.animeongaku.data.remote.OngakuManualAnimeResponse
import com.takeya.animeongaku.data.remote.OngakuMeResponse
import com.takeya.animeongaku.data.remote.OngakuPlayAcceptedResponse
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistRequest
import com.takeya.animeongaku.data.remote.OngakuPlaylistResponse
import com.takeya.animeongaku.data.remote.OngakuSyncQueuedResponse
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.auth.ServerSyncMode
import com.takeya.animeongaku.sync.FirstSyncProgress
import com.takeya.animeongaku.sync.InitialLibrarySyncException
import com.takeya.animeongaku.sync.LibraryPuller
import com.takeya.animeongaku.sync.LibraryPullResult
import com.takeya.animeongaku.sync.ServerInitialLibrarySync
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class ServerInitialLibrarySyncTest {

    private fun status(
        state: String,
        phase: String? = null,
        progress: Map<String, Any?> = emptyMap()
    ): OngakuSyncStatusResponse = OngakuSyncStatusResponse(
        state = state,
        phase = phase,
        progress = progress,
        lastCompletedAt = null,
        unmatched = emptyList()
    )

    private class FakeLibraryPuller : LibraryPuller {
        var pullCalls = 0
        var lastForceFull: Boolean? = null
        override suspend fun pullNow(forceFull: Boolean): LibraryPullResult {
            pullCalls++
            lastForceFull = forceFull
            return LibraryPullResult(applied = true)
        }
    }

    private fun sync(
        api: StatusScriptOngakuApi,
        puller: FakeLibraryPuller = FakeLibraryPuller()
    ): ServerInitialLibrarySync = ServerInitialLibrarySync(api, puller)

    @Test
    fun `waits through metadata phases then pulls library and completes`() = runTest {
        val api = StatusScriptOngakuApi(
            listOf(
                { status("QUEUED") },
                { status("RUNNING", phase = "SYNCING_LIBRARY", progress = mapOf("processed" to 1)) },
                { status("RUNNING", phase = "MAPPING_THEMES", progress = mapOf("processed" to 10)) },
                { status("DONE", phase = "DONE") }
            )
        )
        val puller = FakeLibraryPuller()
        val progress = mutableListOf<FirstSyncProgress>()

        sync(api, puller).runInitialSync { progress += it }

        assertEquals(true, api.lastSyncRequest?.full)
        assertEquals(1, puller.pullCalls)
        assertEquals(true, puller.lastForceFull)
        // Steps only move forward: library sync (1) -> theme matching (2) -> device load (3).
        val steps = progress.map { it.step.stepNumber }
        assertEquals(steps.sorted(), steps)
        assertEquals(3, steps.last())
        assertEquals("Library ready", progress.last().message)
    }

    @Test
    fun `delta mode requests a delta server sync but still fully loads the device`() = runTest {
        val api = StatusScriptOngakuApi(
            listOf(
                { status("RUNNING", phase = "KITSU_DELTA_SYNC") },
                { status("DONE", phase = "DONE") }
            )
        )
        val puller = FakeLibraryPuller()

        sync(api, puller).runInitialSync(ServerSyncMode.DELTA)

        assertEquals(false, api.lastSyncRequest?.full)
        assertEquals(1, puller.pullCalls)
        assertEquals(true, puller.lastForceFull)
    }

    @Test
    fun `failed server sync throws instead of leaving the app waiting`() = runTest {
        val api = StatusScriptOngakuApi(
            listOf(
                { status("RUNNING", phase = "SYNCING_LIBRARY") },
                { status("FAILED", progress = mapOf("error" to "kitsu unavailable")) }
            )
        )

        try {
            sync(api).runInitialSync()
            fail("expected InitialLibrarySyncException")
        } catch (e: InitialLibrarySyncException) {
            assertTrue(e.message!!.contains("kitsu unavailable"))
        }
    }

    @Test
    fun `transient status poll failures are retried`() = runTest {
        val api = StatusScriptOngakuApi(
            listOf(
                { throw IOException("timeout") },
                { throw IOException("timeout") },
                { status("DONE", phase = "DONE") }
            )
        )
        val puller = FakeLibraryPuller()

        sync(api, puller).runInitialSync()

        assertEquals(1, puller.pullCalls)
    }

    @Test
    fun `persistent status poll failures throw a friendly error`() = runTest {
        val api = StatusScriptOngakuApi(List(10) { { throw IOException("timeout") } })

        try {
            sync(api).runInitialSync()
            fail("expected InitialLibrarySyncException")
        } catch (e: InitialLibrarySyncException) {
            assertTrue(e.message!!.contains("Lost connection"))
        }
    }

    @Test
    fun `sync with no observable progress times out instead of hanging`() = runTest {
        val frozen = status("RUNNING", phase = "SYNCING_LIBRARY", progress = mapOf("processed" to 5))
        val api = StatusScriptOngakuApi(List(50) { { frozen } })
        val subject = sync(api)
        var fakeNowMs = 0L
        subject.clock = { fakeNowMs.also { fakeNowMs += 60_000L } }
        subject.stallTimeoutMs = 5 * 60_000L

        try {
            subject.runInitialSync()
            fail("expected InitialLibrarySyncException")
        } catch (e: InitialLibrarySyncException) {
            assertTrue(e.message!!.contains("stopped making progress"))
        }
    }
}

/** OngakuApi fake whose syncStatus() replays a script of responses (last one repeats). */
private class StatusScriptOngakuApi(
    private val script: List<() -> OngakuSyncStatusResponse>
) : OngakuApi {
    var lastSyncRequest: OngakuSyncRequest? = null
    private var index = 0

    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse {
        lastSyncRequest = request
        return OngakuSyncQueuedResponse(jobId = 1L)
    }

    override suspend fun syncStatus(): OngakuSyncStatusResponse {
        val step = script[index.coerceAtMost(script.size - 1)]
        index++
        return step()
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun changes(since: Long?): OngakuChangesResponse = error("unused")
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): com.takeya.animeongaku.data.remote.OngakuSearchResponse =
        error("unused")
    override suspend fun artist(slug: String): com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse =
        error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto =
        error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(since: Long?): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse =
        error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long, opTs: Long?): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
}
