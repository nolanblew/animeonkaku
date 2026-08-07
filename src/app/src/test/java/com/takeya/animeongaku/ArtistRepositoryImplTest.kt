package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ArtistImageDao
import com.takeya.animeongaku.data.local.ArtistImageEntity
import com.takeya.animeongaku.data.remote.AnimeThemesSearchData
import com.takeya.animeongaku.data.remote.AnimeThemesSearchResponse
import com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse
import com.takeya.animeongaku.data.remote.ApiSearchArtist
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
import com.takeya.animeongaku.data.remote.OngakuSearchResponse
import com.takeya.animeongaku.data.remote.OngakuSyncQueuedResponse
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.data.repository.ArtistRepositoryImpl
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.Response

class ArtistRepositoryImplTest {

    @Test
    fun `refreshArtistImages swallows offline lookup failures`() = runBlocking {
        val artistImageDao = FakeArtistImageDao()
        val repository = ArtistRepositoryImpl(
            ongakuApi = FakeArtistOngakuApi(error = RuntimeException("offline")),
            serverSettingsStore = serverSettings(),
            artistImageDao = artistImageDao,
            sessionStateManager = activeSessionStateManager()
        )

        repository.refreshArtistImages(listOf("LiSA"))

        val cached = artistImageDao.getByNames(listOf("LiSA")).singleOrNull()
        assertNotNull(cached)
        assertEquals("LiSA", cached?.name)
        assertNull(cached?.imageUrl)
    }

    @Test
    fun `refreshArtistImages caches server-hosted artist media url`() = runBlocking {
        val artistImageDao = FakeArtistImageDao()
        val repository = ArtistRepositoryImpl(
            ongakuApi = FakeArtistOngakuApi(
                searchResponse = OngakuSearchResponse(
                    query = "Karuta",
                    animeThemes = AnimeThemesSearchResponse(
                        search = AnimeThemesSearchData(
                            artists = listOf(ApiSearchArtist(id = 7L, name = "Karuta", slug = "karuta"))
                        )
                    )
                )
            ),
            serverSettingsStore = serverSettings(),
            artistImageDao = artistImageDao,
            sessionStateManager = activeSessionStateManager()
        )

        repository.refreshArtistImages(listOf("Karuta"))

        val cached = artistImageDao.getByNames(listOf("Karuta")).single()
        assertEquals("http://192.168.1.5:8080/api/v1/media/images/artists/karuta", cached.imageUrl)
    }

    @Test
    fun `refreshArtistImages skips online lookup while session is not active`() = runBlocking {
        val artistImageDao = FakeArtistImageDao()
        val api = FakeArtistOngakuApi()
        val repository = ArtistRepositoryImpl(
            ongakuApi = api,
            serverSettingsStore = serverSettings(),
            artistImageDao = artistImageDao,
            sessionStateManager = reauthSessionStateManager()
        )

        repository.refreshArtistImages(listOf("Karuta"))

        assertEquals(0, api.searchCalls)
        assertEquals(emptyList<ArtistImageEntity>(), artistImageDao.getByNames(listOf("Karuta")))
    }

    private fun serverSettings(): ServerSettingsStore =
        ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }

    private fun activeSessionStateManager(): SessionStateManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "nblew"))
        }
        return SessionStateManager(tokenStore)
    }

    private fun reauthSessionStateManager(): SessionStateManager =
        activeSessionStateManager().apply { markUnauthorized() }
}

private class FakeArtistOngakuApi(
    private val searchResponse: OngakuSearchResponse = OngakuSearchResponse(""),
    private val error: RuntimeException? = null
) : OngakuApi {
    var searchCalls = 0

    override suspend fun search(query: String): OngakuSearchResponse {
        searchCalls++
        error?.let { throw it }
        return searchResponse
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun changes(since: Long?): OngakuChangesResponse = error("unused")
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun artist(slug: String): AnimeThemesSingleArtistResponse = error("unused")
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
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}

private class FakeArtistImageDao : ArtistImageDao {
    private val stored = linkedMapOf<String, ArtistImageEntity>()

    override fun observeByNames(names: List<String>): Flow<List<ArtistImageEntity>> =
        flowOf(names.mapNotNull(stored::get))

    override suspend fun getByNames(names: List<String>): List<ArtistImageEntity> =
        names.mapNotNull(stored::get)

    override suspend fun upsertAll(images: List<ArtistImageEntity>) {
        images.forEach { image -> stored[image.name] = image }
    }
}
