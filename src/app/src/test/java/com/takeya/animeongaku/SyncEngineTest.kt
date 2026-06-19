package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.PendingOpEntity
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
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.SyncEngine
import com.takeya.animeongaku.sync.SyncEngineStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class SyncEngineTest {
    @Test
    fun `enqueue theme pref supersedes older queued state and push drains only after success`() = runBlocking {
        val store = FakeSyncEngineStore()
        val api = SyncRecordingOngakuApi()
        val engine = syncEngine(store, api)

        engine.enqueueThemePreference(themeId = 100L, liked = true, disliked = false, opTs = 10L)
        engine.enqueueThemePreference(themeId = 100L, liked = false, disliked = true, opTs = 20L)

        assertEquals(1, store.ops.size)

        val result = engine.pushPendingWrites()

        assertEquals(1, result.opCount)
        assertEquals(100L to OngakuThemePrefPatch(liked = false, disliked = true, opTs = 20L), api.prefWrites.single())
        assertTrue(store.ops.isEmpty())
    }

    @Test
    fun `failed pending op is retained and attempts increment`() = runBlocking {
        val store = FakeSyncEngineStore()
        val api = SyncRecordingOngakuApi(failPrefWrite = true)
        val engine = syncEngine(store, api)

        engine.enqueueThemePreference(themeId = 100L, liked = true, disliked = false, opTs = 10L)

        val result = engine.pushPendingWrites()

        assertEquals(0, result.opCount)
        assertEquals(1, store.ops.single().attempts)
    }

    @Test
    fun `failed pref write does not block independent newer pref write`() = runBlocking {
        val store = FakeSyncEngineStore()
        val api = SyncRecordingOngakuApi(failPrefThemeIds = setOf(12994L))
        val engine = syncEngine(store, api)

        engine.enqueueThemePreference(themeId = 12994L, liked = true, disliked = false, opTs = 10L)
        engine.enqueueThemePreference(themeId = 6884L, liked = true, disliked = false, opTs = 20L)

        val result = engine.pushPendingWrites()

        assertEquals(1, result.opCount)
        assertEquals(true, result.failed)
        assertEquals(6884L to OngakuThemePrefPatch(liked = true, disliked = false, opTs = 20L), api.prefWrites.single())
        assertEquals("12994", store.ops.single().entityKey)
        assertEquals(1, store.ops.single().attempts)
    }

    @Test
    fun `offline playlist create remaps queued follow up ops to server id`() = runBlocking {
        val store = FakeSyncEngineStore()
        val api = SyncRecordingOngakuApi(
            createPlaylistResponse = OngakuPlaylistDto(
                id = 900L,
                name = "Road",
                entries = listOf(100L),
                isAuto = false,
                updatedAt = 30L,
                dynamicSpecJson = null
            )
        )
        val engine = syncEngine(store, api)

        engine.enqueuePlaylistCreate(playlistId = -10L, name = "Road", entries = listOf(100L), opTs = 10L)
        engine.enqueuePlaylistRename(playlistId = -10L, name = "Road 2", opTs = 20L)

        val result = engine.pushPendingWrites()

        assertEquals(2, result.opCount)
        assertEquals(-10L to 900L, store.remaps.single())
        assertEquals(900L, api.updatedPlaylistId)
        assertEquals("Road 2", api.updatedPlaylistRequest?.name)
        assertTrue(store.ops.isEmpty())
    }

    @Test
    fun `pushPendingWrites does not hit server when session is not active`() = runBlocking {
        val store = FakeSyncEngineStore()
        val api = SyncRecordingOngakuApi()
        val engine = syncEngine(store, api, reauthSessionStateManager())

        engine.enqueueThemePreference(themeId = 100L, liked = true, disliked = false, opTs = 10L)

        val result = engine.pushPendingWrites()

        assertEquals(0, result.opCount)
        assertEquals(0, result.playCount)
        assertTrue(api.prefWrites.isEmpty())
        assertEquals(1, store.ops.size)
    }

    private fun syncEngine(
        store: FakeSyncEngineStore,
        api: SyncRecordingOngakuApi,
        sessionStateManager: SessionStateManager = activeSessionStateManager()
    ): SyncEngine =
        SyncEngine(
            store = store,
            api = api,
            settings = ServerSettingsStore(FakeSharedPreferences()).apply {
                serverBaseUrl = "http://192.168.1.5:8080/api"
            },
            sessionStateManager = sessionStateManager,
            moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        )

    private fun activeSessionStateManager(): SessionStateManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "nblew"))
        }
        return SessionStateManager(tokenStore)
    }

    private fun reauthSessionStateManager(): SessionStateManager =
        activeSessionStateManager().apply { markUnauthorized() }
}

private class FakeSyncEngineStore : SyncEngineStore {
    val ops = mutableListOf<PendingOpEntity>()
    val remaps = mutableListOf<Pair<Long, Long>>()
    private var nextId = 1L

    override suspend fun insertPendingOp(op: PendingOpEntity): Long {
        val stored = op.copy(id = nextId++)
        ops += stored
        return stored.id
    }

    override suspend fun deleteSupersededPendingOp(entityType: String, entityKey: String, opType: String) {
        ops.removeAll { it.entityType == entityType && it.entityKey == entityKey && it.opType == opType }
    }

    override suspend fun oldestPendingOps(limit: Int): List<PendingOpEntity> =
        ops.sortedWith(compareBy<PendingOpEntity> { it.createdAt }.thenBy { it.id }).take(limit)

    override suspend fun deletePendingOps(ids: List<Long>) {
        ops.removeAll { it.id in ids }
    }

    override suspend fun incrementPendingOpAttempts(id: Long) {
        val index = ops.indexOfFirst { it.id == id }
        if (index >= 0) ops[index] = ops[index].copy(attempts = ops[index].attempts + 1)
    }

    override suspend fun remapPlaylistId(tempId: Long, serverPlaylist: OngakuPlaylistDto) {
        remaps += tempId to serverPlaylist.id
        ops.replaceAll { op ->
            if (op.entityType == PendingOpEntity.ENTITY_PLAYLIST && op.entityKey == tempId.toString()) {
                op.copy(entityKey = serverPlaylist.id.toString())
            } else {
                op
            }
        }
    }
}

private class SyncRecordingOngakuApi(
    private val failPrefWrite: Boolean = false,
    private val failPrefThemeIds: Set<Long> = emptySet(),
    private val createPlaylistResponse: OngakuPlaylistDto = OngakuPlaylistDto(
        id = 1L,
        name = "Created",
        entries = emptyList(),
        isAuto = false,
        updatedAt = 1L,
        dynamicSpecJson = null
    )
) : OngakuApi {
    val prefWrites = mutableListOf<Pair<Long, OngakuThemePrefPatch>>()
    var updatedPlaylistId: Long? = null
    var updatedPlaylistRequest: OngakuPlaylistRequest? = null

    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto {
        if (failPrefWrite || themeId in failPrefThemeIds) error("network down")
        prefWrites += themeId to request
        return OngakuThemePrefDto(
            themeId = themeId,
            liked = request.liked == true,
            disliked = request.disliked == true,
            playCount = 0,
            lastPlayedAt = null,
            updatedAt = request.opTs ?: 0L
        )
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun changes(since: Long?): OngakuChangesResponse = error("unused")
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): com.takeya.animeongaku.data.remote.OngakuSearchResponse = error("unused")
    override suspend fun artist(slug: String): com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse =
        error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(since: Long?): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse =
        OngakuPlaylistResponse(createPlaylistResponse)
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse {
        updatedPlaylistId = id
        updatedPlaylistRequest = request
        return OngakuPlaylistResponse(
            OngakuPlaylistDto(
                id = id,
                name = request.name ?: "Updated",
                entries = request.entries.orEmpty(),
                isAuto = false,
                updatedAt = request.opTs ?: 0L,
                dynamicSpecJson = request.dynamicSpecJson
            )
        )
    }
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long, opTs: Long?): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
