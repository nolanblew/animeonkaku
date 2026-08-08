package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.PendingOpEntity
import com.takeya.animeongaku.data.local.PendingPlayEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuAudioRequestResponse
import com.takeya.animeongaku.data.remote.OngakuActualPlayEvent
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
import com.takeya.animeongaku.data.remote.OngakuMusicApi
import com.takeya.animeongaku.data.remote.OngakuMusicReleaseDto
import com.takeya.animeongaku.data.remote.OngakuSearchResponse
import com.takeya.animeongaku.data.remote.OngakuSongPrefDto
import com.takeya.animeongaku.data.remote.OngakuSongPrefPatch
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.data.repository.withBroadThemeDislike
import com.takeya.animeongaku.data.repository.withModeThemeDislike
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.ServerUserStateRefresher
import com.takeya.animeongaku.sync.SyncEngine
import com.takeya.animeongaku.sync.SyncEngineStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class UserPreferencesRepositoryTest {
    @Test
    fun `set preferred mode persists and syncs without changing reactions`() = runBlocking {
        val dao = FakeUserPreferenceDao().apply {
            insertOrUpdate(UserPreferenceEntity(themeId = 100L, isLiked = true, isDislikedFullSize = true))
        }
        val api = RecordingOngakuApi()
        val store = PreferenceSyncStore()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val repository = UserPreferencesRepository(
            dao, syncEngine(store, api, settings), RecordingServerUserStateRefresher()
        )

        repository.setPreferredMode(100L, "FULL_SIZE")

        val saved = dao.saved.last()
        assertEquals("FULL_SIZE", saved.preferredMode)
        assertTrue(saved.isLiked)
        assertTrue(saved.isDislikedFullSize)
        assertEquals("FULL_SIZE", api.updatedThemePref?.preferredMode)
    }

    @Test
    fun `toggle like writes through to server when server mode is configured`() = runBlocking {
        val dao = FakeUserPreferenceDao()
        val api = RecordingOngakuApi()
        val store = PreferenceSyncStore()
        val refresher = RecordingServerUserStateRefresher()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val repository = UserPreferencesRepository(dao, syncEngine(store, api, settings), refresher)

        repository.toggleLike(themeId = 100L)

        val saved = dao.saved.single()
        assertEquals(100L, saved.themeId)
        assertEquals(true, saved.isLiked)
        assertEquals(false, saved.isDisliked)
        assertTrue(saved.updatedAt > 0L)
        assertEquals(100L, api.updatedThemeId)
        val patch = api.updatedThemePref!!
        assertEquals(true, patch.liked)
        assertEquals(false, patch.disliked)
        assertEquals(false, patch.dislikedTvSize)
        assertEquals(false, patch.dislikedFullSize)
        assertEquals(saved.updatedAt, patch.opTs)
        assertTrue(store.ops.isEmpty())
        assertEquals(1, refresher.localRefreshCalls)
        assertEquals(1, refresher.remoteRefreshCalls)
    }

    @Test
    fun `toggle dislike is retained in outbox and refreshes local user state when server is not configured`() = runBlocking {
        val dao = FakeUserPreferenceDao()
        val api = RecordingOngakuApi()
        val store = PreferenceSyncStore()
        val refresher = RecordingServerUserStateRefresher()
        val settings = ServerSettingsStore(FakeSharedPreferences())
        val repository = UserPreferencesRepository(dao, syncEngine(store, api, settings), refresher)

        repository.toggleDislike(themeId = 100L)

        val saved = dao.saved.single()
        assertEquals(100L, saved.themeId)
        assertEquals(false, saved.isLiked)
        assertEquals(true, saved.isDisliked)
        assertFalse(api.updateCalled)
        assertEquals(PendingOpEntity.ENTITY_THEME_PREF, store.ops.single().entityType)
        assertEquals(1, refresher.localRefreshCalls)
        assertEquals(1, refresher.remoteRefreshCalls)
    }

    @Test
    fun `failed preference push refreshes local user state without pulling stale server state`() = runBlocking {
        val dao = FakeUserPreferenceDao()
        val api = RecordingOngakuApi(failUpdate = true)
        val store = PreferenceSyncStore()
        val refresher = RecordingServerUserStateRefresher()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val repository = UserPreferencesRepository(dao, syncEngine(store, api, settings), refresher)

        repository.toggleLike(themeId = 100L)

        assertEquals(1, refresher.localRefreshCalls)
        assertEquals(0, refresher.remoteRefreshCalls)
        assertEquals(PendingOpEntity.ENTITY_THEME_PREF, store.ops.single().entityType)
        assertEquals(1, store.ops.single().attempts)
    }

    @Test
    fun `reaction mutations always emit a complete normalized theme snapshot`() {
        val base = UserPreferenceEntity(
            themeId = 100L,
            isLiked = true,
            isDisliked = false,
            isDislikedTvSize = false,
            isDislikedFullSize = true,
            preferredMode = "FULL_SIZE"
        )

        val broad = base.withBroadThemeDislike(disliked = true, timestamp = 10L)
        assertEquals(false, broad.isLiked)
        assertEquals(true, broad.isDisliked)
        assertEquals(false, broad.isDislikedTvSize)
        assertEquals(false, broad.isDislikedFullSize)
        assertEquals("FULL_SIZE", broad.preferredMode)

        val scoped = broad.withModeThemeDislike(fullSize = false, disliked = true, timestamp = 11L)
        assertEquals(false, scoped.isLiked)
        assertEquals(false, scoped.isDisliked)
        assertEquals(true, scoped.isDislikedTvSize)
        assertEquals(false, scoped.isDislikedFullSize)
        assertEquals("FULL_SIZE", scoped.preferredMode)
    }

    @Test
    fun `scoped dislike choice replaces broad dislike with one complete preference snapshot`() = runBlocking {
        val dao = FakeUserPreferenceDao().apply {
            insertOrUpdate(
                UserPreferenceEntity(
                    themeId = 100L,
                    isLiked = true,
                    isDisliked = true,
                    isDislikedTvSize = true,
                    isDislikedFullSize = true
                )
            )
        }
        val api = RecordingOngakuApi()
        val store = PreferenceSyncStore()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val repository = UserPreferencesRepository(
            dao,
            syncEngine(store, api, settings),
            RecordingServerUserStateRefresher()
        )

        repository.setOnlyModeDislike(themeId = 100L, fullSize = true)

        val saved = dao.saved.last()
        assertFalse(saved.isLiked)
        assertFalse(saved.isDisliked)
        assertFalse(saved.isDislikedTvSize)
        assertTrue(saved.isDislikedFullSize)
        val patch = api.updatedThemePref!!
        assertEquals(false, patch.liked)
        assertEquals(false, patch.disliked)
        assertEquals(false, patch.dislikedTvSize)
        assertEquals(true, patch.dislikedFullSize)
    }

    @Test
    fun `typed play upload preserves song identity and clears posted UUIDs when accepted is zero`() = runBlocking {
        val store = PreferenceSyncStore().apply {
            plays += PendingPlayEntity(id = 1L, themeId = 10L, playedAt = 1L)
            plays += PendingPlayEntity(id = 2L, themeId = 20L, playedAt = 2L, clientEventId = "c1", itemType = "SONG", itemId = 300L, actualMode = "AUDIO")
        }
        val api = RecordingOngakuApi()
        val musicApi = RecordingOngakuMusicApi()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val result = SyncEngine(
            store = store,
            api = api,
            settings = settings,
            sessionStateManager = activeSessionStateManager(),
            moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build(),
            musicApi = musicApi
        ).pushPendingWrites()

        assertFalse(result.failed)
        assertEquals(listOf(300L), musicApi.uploaded.single().map { it.itemId })
        assertEquals(listOf("SONG"), musicApi.uploaded.single().map { it.itemType })
        assertEquals(listOf(10L), api.recordedLegacyPlays.single().map { it.themeId })
        assertTrue(store.plays.isEmpty())
    }

    private fun syncEngine(
        store: PreferenceSyncStore,
        api: RecordingOngakuApi,
        settings: ServerSettingsStore
    ): SyncEngine =
        SyncEngine(
            store = store,
            api = api,
            settings = settings,
            sessionStateManager = activeSessionStateManager(),
            moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        )

    private fun activeSessionStateManager(): SessionStateManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "nblew"))
        }
        return SessionStateManager(tokenStore)
    }
}

private class RecordingServerUserStateRefresher : ServerUserStateRefresher {
    var localRefreshCalls = 0
    var remoteRefreshCalls = 0

    override suspend fun refreshLocalAfterPreferenceWrite() {
        localRefreshCalls += 1
    }

    override suspend fun refreshAfterPreferenceWrite() {
        remoteRefreshCalls += 1
    }
}

private class FakeUserPreferenceDao : UserPreferenceDao {
    private val preferences = mutableMapOf<Long, UserPreferenceEntity>()
    val saved = mutableListOf<UserPreferenceEntity>()

    override fun observePreference(themeId: Long): Flow<UserPreferenceEntity?> =
        flowOf(preferences[themeId])

    override suspend fun getPreference(themeId: Long): UserPreferenceEntity? =
        preferences[themeId]

    override fun observeAllPreferences(): Flow<List<UserPreferenceEntity>> =
        flowOf(preferences.values.toList())

    override suspend fun getAllPreferences(): List<UserPreferenceEntity> =
        preferences.values.toList()

    override suspend fun getPreferencesByIdsIncludingDeleted(themeIds: List<Long>): List<UserPreferenceEntity> =
        preferences.filterKeys { it in themeIds }.values.toList()

    override suspend fun deleteByThemeIds(themeIds: List<Long>) {
        themeIds.forEach(preferences::remove)
    }

    override suspend fun insertOrUpdate(preference: UserPreferenceEntity) {
        preferences[preference.themeId] = preference
        saved += preference
    }

    override suspend fun upsertAll(preferences: List<UserPreferenceEntity>) {
        preferences.forEach { insertOrUpdate(it) }
    }

    override fun observeLikedThemeIds(): Flow<List<Long>> =
        flowOf(preferences.values.filter { it.isLiked }.map { it.themeId })

    override fun observeDislikedThemeIds(): Flow<List<Long>> =
        flowOf(preferences.values.filter { it.isDisliked }.map { it.themeId })

    override suspend fun getDislikedThemeIds(): List<Long> =
        preferences.values.filter { it.isDisliked }.map { it.themeId }

    override suspend fun getLikedThemeIds(): List<Long> =
        preferences.values.filter { it.isLiked }.map { it.themeId }
}

private class RecordingOngakuApi(
    private val failUpdate: Boolean = false
) : OngakuApi {
    var updateCalled = false
    var updatedThemeId: Long? = null
    var updatedThemePref: OngakuThemePrefPatch? = null

    override suspend fun updateThemePref(
        themeId: Long,
        request: OngakuThemePrefPatch
    ): OngakuThemePrefDto {
        if (failUpdate) error("network down")
        updateCalled = true
        updatedThemeId = themeId
        updatedThemePref = request
        return OngakuThemePrefDto(
            themeId = themeId,
            liked = request.liked == true,
            disliked = request.disliked == true,
            playCount = 0,
            lastPlayedAt = null
        )
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
    val recordedLegacyPlays = mutableListOf<List<OngakuPlayEvent>>()
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse {
        recordedLegacyPlays += plays
        return OngakuPlayAcceptedResponse(accepted = plays.size)
    }
        override suspend fun playlists(since: Long?): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long, opTs: Long?): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}

private class PreferenceSyncStore : SyncEngineStore {
    val ops = mutableListOf<PendingOpEntity>()
    val plays = mutableListOf<PendingPlayEntity>()
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

    override suspend fun remapPlaylistId(tempId: Long, serverPlaylist: OngakuPlaylistDto) = Unit

    override suspend fun oldestPendingPlays(limit: Int): List<PendingPlayEntity> = plays.take(limit)

    override suspend fun deletePendingPlays(ids: List<Long>) {
        plays.removeAll { it.id in ids }
    }
}

private class RecordingOngakuMusicApi : OngakuMusicApi {
    val uploaded = mutableListOf<List<OngakuActualPlayEvent>>()

    override suspend fun recordActualPlays(plays: List<OngakuActualPlayEvent>): OngakuPlayAcceptedResponse {
        uploaded += plays
        return OngakuPlayAcceptedResponse(accepted = 0)
    }

    override suspend fun search(query: String): OngakuSearchResponse = error("unused")
    override suspend fun animeMusic(kitsuId: String) = error("unused")
    override suspend fun musicRelease(releaseId: Long): OngakuMusicReleaseDto = error("unused")
    override suspend fun songPrefs(since: Long?): List<OngakuSongPrefDto> = error("unused")
    override suspend fun updateSongPref(songId: Long, request: OngakuSongPrefPatch): OngakuSongPrefDto = error("unused")
    override suspend fun deleteSongPref(songId: Long, opTs: Long?): Response<Unit> = Response.success(Unit)
}
