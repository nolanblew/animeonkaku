package com.takeya.animeongaku

import com.takeya.animeongaku.data.remote.AnimeThemesSearchData
import com.takeya.animeongaku.data.remote.AnimeThemesSearchResponse
import com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse
import com.takeya.animeongaku.data.remote.ApiAnime
import com.takeya.animeongaku.data.remote.ApiArtist
import com.takeya.animeongaku.data.remote.ApiArtistProfileWithSongs
import com.takeya.animeongaku.data.remote.ApiArtistSongWithThemes
import com.takeya.animeongaku.data.remote.ApiAudio
import com.takeya.animeongaku.data.remote.ApiResource
import com.takeya.animeongaku.data.remote.ApiSearchArtist
import com.takeya.animeongaku.data.remote.ApiSong
import com.takeya.animeongaku.data.remote.ApiTheme
import com.takeya.animeongaku.data.remote.ApiThemeEntry
import com.takeya.animeongaku.data.remote.ApiThemeWithAnime
import com.takeya.animeongaku.data.remote.ApiVideo
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
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
import com.takeya.animeongaku.data.remote.OngakuSearchResponse
import com.takeya.animeongaku.data.remote.OngakuSyncQueuedResponse
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.data.remote.OngakuThemeArtistDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.repository.ServerAnimeRepository
import com.takeya.animeongaku.data.server.ServerSettingsStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response

class ServerAnimeRepositoryTest {
    @Test
    fun `search maps proxied AnimeThemes results to server media urls`() = runBlocking {
        val api = SearchRecordingOngakuApi(
            searchResponse = OngakuSearchResponse(
                query = "bocchi",
                animeThemes = AnimeThemesSearchResponse(
                    search = AnimeThemesSearchData(
                        anime = listOf(
                            apiAnime(
                                animeId = 55L,
                                kitsuId = "123",
                                themeId = 777L,
                                title = "Seishun Complex"
                            )
                        ),
                        artists = listOf(ApiSearchArtist(id = 8L, name = "Kessoku Band", slug = "kessoku-band"))
                    )
                )
            )
        )
        val repository = serverAnimeRepository(api)

        val result = repository.searchAnimeThemes("bocchi")

        assertEquals("bocchi", api.searchQueries.single())
        assertEquals(listOf("Seishun Complex"), result.themes.map { it.title })
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/777", result.themes.single().audioUrl)
        assertEquals(listOf("Bocchi the Rock!"), result.anime.map { it.name })
        assertEquals(listOf("Kessoku Band"), result.artists.map { it.name })
    }

    @Test
    fun `anime detail maps typed server response to theme entries`() = runBlocking {
        val api = SearchRecordingOngakuApi(
            animeResponse = OngakuAnimeDetailResponse(
                anime = OngakuAnimeDto(
                    kitsuId = "123",
                    animeThemesId = 55L,
                    title = "Bocchi the Rock!",
                    titleEn = "Bocchi the Rock!",
                    titleRomaji = null,
                    titleJa = null,
                    posterUrl = "/v1/media/images/anime/123/poster",
                    coverUrl = "/v1/media/images/anime/123/cover",
                    watchingStatus = "current",
                    subtype = "TV",
                    startDate = null,
                    endDate = null,
                    episodeCount = 12,
                    ageRating = null,
                    averageRating = 8.7,
                    userRating = 9.0,
                    libraryUpdatedAt = 100L,
                    slug = "bocchi-the-rock",
                    genres = listOf("Music"),
                    updatedAt = 200L,
                    deleted = false
                ),
                themes = listOf(
                    OngakuThemeDto(
                        id = 777L,
                        animeThemesAnimeId = 55L,
                        kitsuAnimeIds = listOf("123"),
                        title = "Seishun Complex",
                        themeType = "OP1",
                        artists = listOf(OngakuThemeArtistDto("Kessoku Band", null, null)),
                        audioUrl = "/v1/media/audio/777",
                        videoUrl = "https://v.animethemes.moe/bocchi.webm",
                        audioState = "READY",
                        durationSeconds = 90,
                        fileSize = 123L,
                        updatedAt = 300L,
                        deleted = false
                    )
                )
            )
        )
        val repository = serverAnimeRepository(api)

        val result = repository.fetchAnimeByKitsuId("123")

        assertEquals("123", api.animeRequests.single())
        assertEquals(mapOf("123" to 55L), result.animeMappings)
        assertEquals("Seishun Complex", result.themes.single().title)
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/777", result.themes.single().audioUrl)
    }

    @Test
    fun `artist detail maps proxied artist songs`() = runBlocking {
        val api = SearchRecordingOngakuApi(
            artistResponse = AnimeThemesSingleArtistResponse(
                artist = ApiArtistProfileWithSongs(
                    id = 9L,
                    name = "Kessoku Band",
                    slug = "kessoku-band",
                    songs = listOf(
                        ApiArtistSongWithThemes(
                            title = "Seishun Complex",
                            artists = listOf(ApiArtist(name = "Kessoku Band")),
                            animethemes = listOf(
                                ApiThemeWithAnime(
                                    id = 777L,
                                    type = "OP",
                                    sequence = 1,
                                    anime = apiAnime(
                                        animeId = 55L,
                                        kitsuId = "123",
                                        themeId = 777L,
                                        title = "Seishun Complex"
                                    ),
                                    animethemeentries = listOf(
                                        ApiThemeEntry(
                                            videos = listOf(ApiVideo(audio = ApiAudio(path = "bocchi.webm")))
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )
        val repository = serverAnimeRepository(api)

        val result = repository.fetchArtistSongs("kessoku-band")

        assertEquals("kessoku-band", api.artistRequests.single())
        assertEquals("Seishun Complex", result.single().title)
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/777", result.single().audioUrl)
    }

    private fun serverAnimeRepository(api: SearchRecordingOngakuApi): ServerAnimeRepository {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        return ServerAnimeRepository(api, settings)
    }
}

private fun apiAnime(
    animeId: Long,
    kitsuId: String,
    themeId: Long,
    title: String
) = ApiAnime(
    id = animeId,
    name = "Bocchi the Rock!",
    resources = listOf(ApiResource(externalId = kitsuId, site = "Kitsu")),
    animethemes = listOf(
        ApiTheme(
            id = themeId,
            type = "OP",
            sequence = 1,
            song = ApiSong(title = title, artists = listOf(ApiArtist(name = "Kessoku Band"))),
            animethemeentries = listOf(
                ApiThemeEntry(videos = listOf(ApiVideo(audio = ApiAudio(path = "bocchi.webm"))))
            )
        )
    )
)

private class SearchRecordingOngakuApi(
    private val searchResponse: OngakuSearchResponse = OngakuSearchResponse(""),
    private val animeResponse: OngakuAnimeDetailResponse? = null,
    private val artistResponse: AnimeThemesSingleArtistResponse = AnimeThemesSingleArtistResponse()
) : OngakuApi {
    val searchQueries = mutableListOf<String>()
    val animeRequests = mutableListOf<String>()
    val artistRequests = mutableListOf<String>()

    override suspend fun search(query: String): OngakuSearchResponse {
        searchQueries += query
        return searchResponse
    }

    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse {
        animeRequests += kitsuId
        return animeResponse ?: error("unused")
    }

    override suspend fun artist(slug: String): AnimeThemesSingleArtistResponse {
        artistRequests += slug
        return artistResponse
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto =
        error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse =
        error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
