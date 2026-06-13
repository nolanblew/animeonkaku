package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuAudioRequestResponse
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
import com.takeya.animeongaku.data.repository.PlaylistWriteStore
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.server.ServerSettingsStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class ServerPlaylistWriterTest {
    @Test
    fun `server mode creates playlist on server and applies returned server id locally`() = runBlocking {
        val store = FakePlaylistWriteStore()
        val api = PlaylistRecordingOngakuApi(
            createResponse = OngakuPlaylistDto(
                id = 900L,
                name = "Mix",
                entries = listOf(100L, 101L),
                isAuto = false,
                updatedAt = 1760000000000,
                dynamicSpecJson = null
            )
        )
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val writer = ServerPlaylistWriter(store, api, settings)

        val id = writer.createPlaylist("Mix", listOf(100L, 101L))

        assertEquals(900L, id)
        assertEquals(OngakuPlaylistRequest(name = "Mix", entries = listOf(100L, 101L)), api.createdRequest)
        assertEquals(900L, store.appliedServerPlaylists.single().id)
        assertEquals(emptyList<Long>(), store.createdLocalIds)
    }

    @Test
    fun `add entries syncs manual playlist entries to server`() = runBlocking {
        val store = FakePlaylistWriteStore(
            playlists = mutableMapOf(
                900L to PlaylistEntity(id = 900L, name = "Mix", createdAt = 1L, isAuto = false)
            ),
            entries = mutableMapOf(900L to mutableListOf(100L))
        )
        val api = PlaylistRecordingOngakuApi()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val writer = ServerPlaylistWriter(store, api, settings)

        writer.addEntries(900L, listOf(101L, 102L))

        assertEquals(listOf(100L, 101L, 102L), store.entries[900L])
        assertEquals(900L, api.updatedPlaylistId)
        assertEquals(OngakuPlaylistRequest(entries = listOf(100L, 101L, 102L)), api.updatedRequest)
    }

    @Test
    fun `auto playlist entry changes are not written to server`() = runBlocking {
        val store = FakePlaylistWriteStore(
            playlists = mutableMapOf(
                77L to PlaylistEntity(id = 77L, name = "Liked Songs", createdAt = 1L, isAuto = true)
            ),
            entries = mutableMapOf(77L to mutableListOf(100L))
        )
        val api = PlaylistRecordingOngakuApi()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val writer = ServerPlaylistWriter(store, api, settings)

        writer.addEntries(77L, listOf(101L))

        assertEquals(listOf(100L, 101L), store.entries[77L])
        assertFalse(api.updateCalled)
    }

    @Test
    fun `blank server mode keeps playlist writes local`() = runBlocking {
        val store = FakePlaylistWriteStore()
        val api = PlaylistRecordingOngakuApi()
        val settings = ServerSettingsStore(FakeSharedPreferences())
        val writer = ServerPlaylistWriter(store, api, settings)

        val id = writer.createPlaylist("Local Mix", listOf(100L))

        assertEquals(1L, id)
        assertEquals(listOf(1L), store.createdLocalIds)
        assertFalse(api.createCalled)
    }
}

private class FakePlaylistWriteStore(
    val playlists: MutableMap<Long, PlaylistEntity> = mutableMapOf(),
    val entries: MutableMap<Long, MutableList<Long>> = mutableMapOf()
) : PlaylistWriteStore {
    val createdLocalIds = mutableListOf<Long>()
    val appliedServerPlaylists = mutableListOf<OngakuPlaylistDto>()
    private var nextId = 1L

    override suspend fun createLocalPlaylist(name: String, entries: List<Long>): Long {
        val id = nextId++
        playlists[id] = PlaylistEntity(id = id, name = name, createdAt = 1L)
        this.entries[id] = entries.toMutableList()
        createdLocalIds += id
        return id
    }

    override suspend fun applyServerPlaylist(playlist: OngakuPlaylistDto) {
        playlists[playlist.id] = PlaylistEntity(
            id = playlist.id,
            name = playlist.name,
            createdAt = playlist.updatedAt,
            isAuto = playlist.isAuto
        )
        entries[playlist.id] = playlist.entries.toMutableList()
        appliedServerPlaylists += playlist
    }

    override suspend fun addEntries(playlistId: Long, themeIds: List<Long>) {
        entries.getOrPut(playlistId) { mutableListOf() }.addAll(themeIds)
    }

    override suspend fun renamePlaylist(playlistId: Long, name: String) {
        playlists[playlistId] = playlists.getValue(playlistId).copy(name = name)
    }

    override suspend fun deletePlaylist(playlistId: Long) {
        playlists.remove(playlistId)
        entries.remove(playlistId)
    }

    override suspend fun playlistById(playlistId: Long): PlaylistEntity? =
        playlists[playlistId]

    override suspend fun themeIdsInPlaylist(playlistId: Long): List<Long> =
        entries[playlistId].orEmpty()
}

private class PlaylistRecordingOngakuApi(
    private val createResponse: OngakuPlaylistDto = OngakuPlaylistDto(
        id = 1L,
        name = "Created",
        entries = emptyList(),
        isAuto = false,
        updatedAt = 1L,
        dynamicSpecJson = null
    )
) : OngakuApi {
    var createCalled = false
    var updateCalled = false
    var createdRequest: OngakuPlaylistRequest? = null
    var updatedPlaylistId: Long? = null
    var updatedRequest: OngakuPlaylistRequest? = null

    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse {
        createCalled = true
        createdRequest = request
        return OngakuPlaylistResponse(createResponse)
    }

    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse {
        updateCalled = true
        updatedPlaylistId = id
        updatedRequest = request
        return OngakuPlaylistResponse(
            OngakuPlaylistDto(
                id = id,
                name = request.name ?: "Updated",
                entries = request.entries.orEmpty(),
                isAuto = false,
                updatedAt = 1L,
                dynamicSpecJson = request.dynamicSpecJson
            )
        )
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): Any = error("unused")
    override suspend fun artist(slug: String): Any = error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto = error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
