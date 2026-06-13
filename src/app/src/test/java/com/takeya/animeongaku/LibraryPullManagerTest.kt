package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
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
import com.takeya.animeongaku.data.remote.OngakuSyncQueuedResponse
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse
import com.takeya.animeongaku.data.remote.OngakuThemeArtistDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.LibraryPullCache
import com.takeya.animeongaku.sync.LibraryPullManager
import com.takeya.animeongaku.sync.LibraryPullSideEffects
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class LibraryPullManagerTest {
    @Test
    fun `pull uses cursor maps library and reconciles server user state`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
            serverPullCursor = 123L
        }
        val existingDownloaded = ThemeEntity(
            id = 100L,
            animeId = 10L,
            title = "Old",
            artistName = null,
            audioUrl = "https://old.example/audio.webm",
            videoUrl = null,
            isDownloaded = true,
            localFilePath = "/downloads/100.webm"
        )
        val api = FakeOngakuApi(
            libraryResponse = libraryResponse(),
            prefsResponse = listOf(
                OngakuThemePrefDto(
                    themeId = 100L,
                    liked = true,
                    disliked = false,
                    playCount = 7,
                    lastPlayedAt = 1760000000500
                )
            ),
            autoPlaylistResponse = listOf(
                OngakuPlaylistDto(
                    id = 77L,
                    name = "Server Auto",
                    entries = listOf(100L),
                    isAuto = true,
                    updatedAt = 1760000000000,
                    dynamicSpecJson = null
                ),
                OngakuPlaylistDto(
                    id = 88L,
                    name = "Manual Mix",
                    entries = listOf(100L),
                    isAuto = false,
                    updatedAt = 1760000000001,
                    dynamicSpecJson = null
                )
            )
        )
        val cache = FakeLibraryPullCache(mapOf(100L to existingDownloaded))
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects())

        val result = manager.pullNow(forceFull = false)

        assertTrue(result.applied)
        assertEquals(123L, api.requestedSince)
        assertEquals(1760000000000, settings.serverPullCursor)
        assertEquals(listOf("gone"), cache.deletedKitsuIds)
        assertEquals(listOf(101L), cache.deletedThemeIds)
        assertEquals("Bocchi the Rock!", cache.upsertedAnime.single().title)
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/100", cache.upsertedThemes.single().audioUrl)
        assertTrue(cache.upsertedThemes.single().isDownloaded)
        assertEquals("/downloads/100.webm", cache.upsertedThemes.single().localFilePath)
        assertEquals("Kessoku Band", cache.artistRefs.single().artistName)
        assertEquals(listOf("music"), cache.genres.map { it.slug })
        assertEquals(true, cache.preferences.single().isLiked)
        assertEquals(7, cache.playCounts.single().playCount)
        assertTrue(api.playlistsCalled)
        assertFalse(api.autoPlaylistsCalled)
        assertEquals(listOf("Server Auto", "Manual Mix"), cache.autoPlaylists.map { it.name })
        assertEquals(listOf(100L, 100L), cache.autoEntries.map { it.themeId })
    }

    @Test
    fun `pull flushes pending writes before reading server and refreshes dynamic playlists after applying`() = runBlocking {
        val events = mutableListOf<String>()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val api = FakeOngakuApi(
            libraryResponse = libraryResponse(),
            prefsResponse = emptyList(),
            autoPlaylistResponse = emptyList(),
            events = events
        )
        val cache = FakeLibraryPullCache(emptyMap(), events)
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(events))

        manager.pullNow(forceFull = true)

        assertEquals(
            listOf("flush", "library", "applyLibrary", "applyPrefs", "applyAuto", "refreshDynamic"),
            events
        )
    }

    @Test
    fun `pull is skipped when server is not configured`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences())
        val api = FakeOngakuApi(libraryResponse(), emptyList(), emptyList())
        val cache = FakeLibraryPullCache(emptyMap())
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects())

        val result = manager.pullNow(forceFull = false)

        assertFalse(result.applied)
        assertEquals(null, api.requestedSince)
        assertEquals(0L, settings.serverPullCursor)
    }

    @Test
    fun `pull if stale honors interval and records successful pull time`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
            serverPullCursor = 123L
            serverLastPullAt = 10_000L
        }
        val api = FakeOngakuApi(libraryResponse(), emptyList(), emptyList())
        val cache = FakeLibraryPullCache(emptyMap())
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects())

        val freshResult = manager.pullIfStale(minIntervalMs = 5_000L, now = 14_000L)

        assertFalse(freshResult.applied)
        assertEquals(null, api.requestedSince)
        assertEquals(10_000L, settings.serverLastPullAt)

        val staleResult = manager.pullIfStale(minIntervalMs = 5_000L, now = 15_001L)

        assertTrue(staleResult.applied)
        assertEquals(123L, api.requestedSince)
        assertEquals(15_001L, settings.serverLastPullAt)
    }

    private fun libraryResponse() = OngakuLibraryResponse(
        serverTime = 1760000000000,
        anime = listOf(
            OngakuAnimeDto(
                kitsuId = "1",
                animeThemesId = 10L,
                title = "Bocchi the Rock!",
                titleEn = "Bocchi the Rock!",
                titleRomaji = null,
                titleJa = null,
                posterUrl = "/v1/media/images/anime/1/poster",
                coverUrl = null,
                watchingStatus = "current",
                subtype = "TV",
                startDate = "2022-10-09",
                endDate = null,
                episodeCount = 12,
                ageRating = "PG",
                averageRating = 8.7,
                userRating = 9.0,
                libraryUpdatedAt = 1758000000000,
                slug = "bocchi-the-rock",
                genres = listOf("Music"),
                updatedAt = 1759000000000,
                deleted = false
            ),
            OngakuAnimeDto(
                kitsuId = "gone",
                animeThemesId = null,
                title = null,
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
                updatedAt = 1759500000000,
                deleted = true
            )
        ),
        themes = listOf(
            OngakuThemeDto(
                id = 100L,
                animeThemesAnimeId = 10L,
                kitsuAnimeIds = listOf("1"),
                title = "Seishun Complex",
                themeType = "OP1",
                artists = listOf(OngakuThemeArtistDto("Kessoku Band", null, null)),
                audioUrl = "/v1/media/audio/100",
                videoUrl = null,
                audioState = "READY",
                durationSeconds = 90,
                fileSize = 5_242_880,
                updatedAt = 1759000000000,
                deleted = false
            ),
            OngakuThemeDto(
                id = 101L,
                animeThemesAnimeId = 10L,
                kitsuAnimeIds = listOf("1"),
                title = "Deleted",
                themeType = "ED1",
                artists = emptyList(),
                audioUrl = "/v1/media/audio/101",
                videoUrl = null,
                audioState = "MISSING",
                durationSeconds = null,
                fileSize = null,
                updatedAt = 1759000000000,
                deleted = true
            )
        )
    )
}

private class FakeLibraryPullCache(
    private val existing: Map<Long, ThemeEntity>,
    private val events: MutableList<String> = mutableListOf()
) : LibraryPullCache {
    var deletedKitsuIds: List<String> = emptyList()
    var deletedThemeIds: List<Long> = emptyList()
    var upsertedAnime: List<AnimeEntity> = emptyList()
    var upsertedThemes: List<ThemeEntity> = emptyList()
    var artistRefs: List<ThemeArtistCrossRef> = emptyList()
    var genres: List<GenreEntity> = emptyList()
    var genreRefs: List<AnimeGenreCrossRef> = emptyList()
    var preferences: List<UserPreferenceEntity> = emptyList()
    var playCounts: List<PlayCountEntity> = emptyList()
    var autoPlaylists: List<PlaylistEntity> = emptyList()
    var autoEntries: List<PlaylistEntryEntity> = emptyList()

    override suspend fun existingThemes(themeIds: List<Long>): Map<Long, ThemeEntity> =
        existing.filterKeys { it in themeIds }

    override suspend fun applyLibraryPull(
        deletedKitsuIds: List<String>,
        deletedThemeIds: List<Long>,
        anime: List<AnimeEntity>,
        themes: List<ThemeEntity>,
        artistRefs: List<ThemeArtistCrossRef>,
        genres: List<GenreEntity>,
        genreRefs: List<AnimeGenreCrossRef>
    ) {
        events += "applyLibrary"
        this.deletedKitsuIds = deletedKitsuIds
        this.deletedThemeIds = deletedThemeIds
        this.upsertedAnime = anime
        this.upsertedThemes = themes
        this.artistRefs = artistRefs
        this.genres = genres
        this.genreRefs = genreRefs
    }

    override suspend fun applyThemePrefs(
        preferences: List<UserPreferenceEntity>,
        playCounts: List<PlayCountEntity>
    ) {
        events += "applyPrefs"
        this.preferences = preferences
        this.playCounts = playCounts
    }

    override suspend fun applyAutoPlaylists(
        playlists: List<PlaylistEntity>,
        entries: List<PlaylistEntryEntity>
    ) {
        events += "applyAuto"
        this.autoPlaylists = playlists
        this.autoEntries = entries
    }
}

private class FakeLibraryPullSideEffects(
    private val events: MutableList<String> = mutableListOf()
) : LibraryPullSideEffects {
    override suspend fun flushPendingWrites() {
        events += "flush"
    }

    override suspend fun refreshDynamicPlaylists() {
        events += "refreshDynamic"
    }
}

private class FakeOngakuApi(
    private val libraryResponse: OngakuLibraryResponse,
    private val prefsResponse: List<OngakuThemePrefDto>,
    private val autoPlaylistResponse: List<OngakuPlaylistDto>,
    private val events: MutableList<String> = mutableListOf()
) : OngakuApi {
    var requestedSince: Long? = null
    var playlistsCalled = false
    var autoPlaylistsCalled = false

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse {
        events += "library"
        requestedSince = since
        return libraryResponse
    }
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): com.takeya.animeongaku.data.remote.OngakuSearchResponse =
        error("unused")
    override suspend fun artist(slug: String): com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse =
        error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = prefsResponse
    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto = error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(): List<OngakuPlaylistDto> {
        playlistsCalled = true
        return autoPlaylistResponse
    }
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> {
        autoPlaylistsCalled = true
        return autoPlaylistResponse.filter { it.isAuto }
    }
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
