package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.DateAnchor
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuAnimeDetailResponse
import com.takeya.animeongaku.data.remote.OngakuAnimeDto
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
import com.takeya.animeongaku.data.remote.OngakuThemeArtistDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefDto
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.remote.OngakuThemeMediaModesDto
import com.takeya.animeongaku.data.remote.OngakuTvSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuFullSizeModeDto
import com.takeya.animeongaku.data.remote.OngakuVideoModeDto
import com.takeya.animeongaku.data.remote.OngakuSongPrefDto
import com.takeya.animeongaku.data.remote.OngakuAnimeMusicDto
import com.takeya.animeongaku.data.remote.OngakuMusicAnimeSummaryDto
import com.takeya.animeongaku.data.remote.OngakuMusicReleaseDto
import com.takeya.animeongaku.data.remote.OngakuMusicTrackDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistItemDto
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.LibraryPullCache
import com.takeya.animeongaku.sync.LibraryPullManager
import com.takeya.animeongaku.sync.LibraryPullSideEffects
import com.takeya.animeongaku.sync.MusicCatalogSnapshot
import com.takeya.animeongaku.sync.legacyPlaylistEntryId
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class LibraryPullManagerTest {
    @Test
    fun `pull uses changes cursor maps library and reconciles server user state`() = runBlocking {
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
                    defaultMode = "FULL_SIZE",
                    items = listOf(
                        OngakuPlaylistItemDto(880L, "THEME", 100L, null),
                        OngakuPlaylistItemDto(881L, "SONG", 300L, null)
                    ),
                    isAuto = true,
                    updatedAt = 1760000000000,
                    dynamicSpecJson = null
                ),
                OngakuPlaylistDto(
                    id = 88L,
                    name = "Manual Mix",
                    entries = listOf(100L, 100L, 101L),
                    isAuto = false,
                    updatedAt = 1760000000001,
                    dynamicSpecJson = null
                ),
                OngakuPlaylistDto(
                    id = 99L,
                    name = "Smart Mix",
                    entries = listOf(100L),
                    isAuto = false,
                    updatedAt = 1760000000002,
                    dynamicSpecJson = mapOf(
                        "filterJson" to mapOf(
                            "type" to "liked"
                        ),
                        "mode" to "AUTO",
                        "createdMode" to "SIMPLE",
                        "schemaVersion" to 1,
                        "sortJson" to mapOf(
                            "keys" to listOf(
                                mapOf(
                                    "attribute" to "TITLE",
                                    "direction" to "ASC"
                                )
                            )
                        ),
                        "simpleStateJson" to mapOf(
                            "likedOnly" to true
                        )
                    )
                ),
                OngakuPlaylistDto(
                    id = 111L,
                    name = "Deleted Manual",
                    entries = emptyList(),
                    isAuto = false,
                    updatedAt = 1760000000003,
                    dynamicSpecJson = null,
                    deleted = true
                )
            ),
            songPrefsResponse = listOf(
                OngakuSongPrefDto(300L, liked = true, disliked = false, playCount = 3, lastPlayedAt = 9L, updatedAt = 10L),
                OngakuSongPrefDto(301L, liked = false, disliked = false, playCount = 0, lastPlayedAt = null, updatedAt = 11L, deleted = true)
            ),
            musicCatalogResponse = listOf(
                OngakuAnimeMusicDto(
                    anime = OngakuMusicAnimeSummaryDto("1", "Bocchi"),
                    releases = listOf(
                        OngakuMusicReleaseDto(
                            id = 200L,
                            title = "OST",
                            artistCredit = "Composer",
                            relationshipType = "SOUNDTRACK",
                            artworkUrl = "/v1/media/images/releases/200",
                            tracks = listOf(
                                OngakuMusicTrackDto(
                                    id = 300L,
                                    title = "Track",
                                    artistCredit = "Composer",
                                    audioUrl = "/v1/media/songs/300/audio",
                                    displayOrder = 4
                                )
                            )
                        )
                    )
                )
            )
        )
        val cache = FakeLibraryPullCache(mapOf(100L to existingDownloaded))
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), activeSessionStateManager())

        val result = manager.pullNow(forceFull = false)

        assertTrue(result.applied)
        assertEquals(123L, api.requestedChangesSince)
        assertEquals(null, api.requestedSince)
        assertEquals(null, api.requestedPlaylistSince)
        assertEquals(1760000000000, settings.serverPullCursor)
        assertEquals(listOf("gone"), cache.deletedKitsuIds)
        assertEquals(listOf(101L), cache.deletedThemeIds)
        assertEquals("Bocchi the Rock!", cache.upsertedAnime.single().title)
        assertEquals("http://192.168.1.5:8080/api/v1/media/audio/100", cache.upsertedThemes.single().audioUrl)
        assertTrue(cache.upsertedThemes.single().isDownloaded)
        assertEquals("/downloads/100.webm", cache.upsertedThemes.single().localFilePath)
        assertEquals("http://192.168.1.5:8080/api/v1/media/songs/300/audio", cache.themeModes.single().fullSizeUrl)
        assertEquals("https://v.animethemes.moe/op.webm", cache.themeModes.single().videoUrl)
        assertEquals("Kessoku Band", cache.artistRefs.single().artistName)
        assertEquals(listOf("music"), cache.genres.map { it.slug })
        assertEquals(true, cache.preferences.single().isLiked)
        assertEquals(7, cache.playCounts.single().playCount)
        assertTrue(api.changesCalled)
        assertFalse(api.playlistsCalled)
        assertFalse(api.autoPlaylistsCalled)
        assertEquals(listOf(111L), cache.deletedPlaylistIds)
        assertEquals(false, cache.pruneMissingAutoPlaylists)
        assertEquals(listOf("Server Auto", "Manual Mix", "Smart Mix"), cache.autoPlaylists.map { it.name })
        assertEquals(listOf(true, false, true), cache.autoPlaylists.map { it.isAuto })
        assertEquals(listOf("THEME", "SONG", "THEME", "THEME", "THEME", "THEME"), cache.autoEntries.map { it.itemType })
        assertEquals(listOf(880L, 881L), cache.autoEntries.filter { it.playlistId == 77L }.map { it.entryId })
        assertEquals("FULL_SIZE", cache.autoPlaylists.single { it.id == 77L }.defaultMode)
        assertEquals(
            listOf(
                legacyPlaylistEntryId(100L, 0),
                legacyPlaylistEntryId(100L, 1),
                legacyPlaylistEntryId(101L, 0)
            ),
            cache.autoEntries.filter { it.playlistId == 88L }.map { it.entryId }
        )
        assertEquals(listOf(300L, 301L), cache.songPreferences.map { it.songId })
        assertEquals(11L, cache.songPreferences.single { it.songId == 301L }.deletedAt)
        assertEquals("http://192.168.1.5:8080/api/v1/media/songs/300/audio", cache.musicCatalog!!.songs.single().audioUrl)
        assertEquals(4, cache.musicCatalog!!.releaseTracks.single().displayOrder)
        assertEquals(99L, cache.dynamicSpecs.single().playlistId)
        assertEquals("""{"type":"liked"}""", cache.dynamicSpecs.single().filterJson)
        assertEquals("AUTO", cache.dynamicSpecs.single().mode)
        assertEquals("SIMPLE", cache.dynamicSpecs.single().createdMode)
        assertEquals("""{"keys":[{"attribute":"TITLE","direction":"ASC"}]}""", cache.dynamicSpecs.single().sortJson)
        assertEquals("""{"likedOnly":true}""", cache.dynamicSpecs.single().simpleStateJson)
        assertTrue(cache.dynamicSpecs.single().serverManaged)
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
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(events), testMoshi(), activeSessionStateManager())

        manager.pullNow(forceFull = true)

        assertEquals(
            listOf("flush", "changes", "applyLibrary", "applyPrefs", "applyAuto", "refreshDynamic"),
            events
        )
        assertTrue(cache.songPreferences.isEmpty())
        assertEquals(null, cache.musicCatalog)
        assertEquals(true, cache.pruneMissingAutoPlaylists)
    }

    @Test
    fun `pull keeps snapshot dynamic playlists client managed`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val api = FakeOngakuApi(
            libraryResponse = libraryResponse(),
            prefsResponse = emptyList(),
            autoPlaylistResponse = listOf(
                OngakuPlaylistDto(
                    id = 99L,
                    name = "Openings",
                    entries = listOf(100L),
                    isAuto = false,
                    updatedAt = 1760000000002,
                    dynamicSpecJson = mapOf(
                        "type" to "theme_type_in",
                        "types" to listOf("OP")
                    ),
                    dynamicSortJson = mapOf(
                        "keys" to listOf(
                            mapOf(
                                "attribute" to "PLAY_COUNT",
                                "direction" to "DESC"
                            )
                        )
                    ),
                    autoUpdate = false
                )
            )
        )
        val cache = FakeLibraryPullCache(emptyMap())
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), activeSessionStateManager())

        manager.pullNow(forceFull = true)

        assertEquals(99L, cache.dynamicSpecs.single().playlistId)
        assertEquals("""{"type":"theme_type_in","types":["OP"]}""", cache.dynamicSpecs.single().filterJson)
        assertEquals("""{"keys":[{"attribute":"PLAY_COUNT","direction":"DESC"}]}""", cache.dynamicSpecs.single().sortJson)
        assertEquals("SNAPSHOT", cache.dynamicSpecs.single().mode)
        assertFalse(cache.dynamicSpecs.single().serverManaged)
    }

    @Test
    fun `pull is skipped when server is not configured`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences())
        val api = FakeOngakuApi(libraryResponse(), emptyList(), emptyList())
        val cache = FakeLibraryPullCache(emptyMap())
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), activeSessionStateManager())

        val result = manager.pullNow(forceFull = false)

        assertFalse(result.applied)
        assertEquals(null, api.requestedChangesSince)
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
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), activeSessionStateManager())

        val freshResult = manager.pullIfStale(minIntervalMs = 5_000L, now = 14_000L)

        assertFalse(freshResult.applied)
        assertEquals(null, api.requestedSince)
        assertEquals(10_000L, settings.serverLastPullAt)

        val staleResult = manager.pullIfStale(minIntervalMs = 5_000L, now = 15_001L)

        assertTrue(staleResult.applied)
        assertEquals(123L, api.requestedChangesSince)
        assertEquals(15_001L, settings.serverLastPullAt)
    }

    @Test
    fun `pullNow does nothing when session is not active`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
            serverPullCursor = 123L
        }
        val api = FakeOngakuApi(libraryResponse(), emptyList(), emptyList())
        val cache = FakeLibraryPullCache(emptyMap())
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val sessionState = SessionStateManager(tokenStore).apply { markUnauthorized() }
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), sessionState)

        val result = manager.pullNow(forceFull = true)

        assertFalse(result.applied)
        assertFalse(api.changesCalled)
        assertEquals(123L, settings.serverPullCursor)
    }

    @Test
    fun `pullIfStale does nothing when session is not active`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
            serverPullCursor = 123L
            serverLastPullAt = 0L
        }
        val api = FakeOngakuApi(libraryResponse(), emptyList(), emptyList())
        val cache = FakeLibraryPullCache(emptyMap())
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val sessionState = SessionStateManager(tokenStore).apply { markUnauthorized() }
        val manager = LibraryPullManager(api, settings, cache, FakeLibraryPullSideEffects(), testMoshi(), sessionState)

        val result = manager.pullIfStale(minIntervalMs = 0L, now = 100_000L)

        assertFalse(result.applied)
        assertFalse(api.changesCalled)
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
                mediaModes = OngakuThemeMediaModesDto(
                    tvSize = OngakuTvSizeModeDto("/v1/media/audio/100", 90, 5_242_880),
                    fullSize = OngakuFullSizeModeDto(300L, "/v1/media/songs/300/audio", 271, 1234, 200L),
                    video = OngakuVideoModeDto("https://v.animethemes.moe/op.webm", "video/webm")
                ),
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
    var themeModes: List<ThemeModeEntity> = emptyList()
    var artistRefs: List<ThemeArtistCrossRef> = emptyList()
    var genres: List<GenreEntity> = emptyList()
    var genreRefs: List<AnimeGenreCrossRef> = emptyList()
    var preferences: List<UserPreferenceEntity> = emptyList()
    var playCounts: List<PlayCountEntity> = emptyList()
    var deletedPlaylistIds: List<Long> = emptyList()
    var pruneMissingAutoPlaylists: Boolean? = null
    var autoPlaylists: List<PlaylistEntity> = emptyList()
    var autoEntries: List<PlaylistEntryEntity> = emptyList()
    var dynamicSpecs: List<DynamicPlaylistSpecEntity> = emptyList()
    var songPreferences: List<SongPreferenceEntity> = emptyList()
    var musicCatalog: MusicCatalogSnapshot? = null

    override suspend fun existingThemes(themeIds: List<Long>): Map<Long, ThemeEntity> =
        existing.filterKeys { it in themeIds }

    override suspend fun applyLibraryPull(
        deletedKitsuIds: List<String>,
        deletedThemeIds: List<Long>,
        anime: List<AnimeEntity>,
        themes: List<ThemeEntity>,
        themeModes: List<ThemeModeEntity>,
        artistRefs: List<ThemeArtistCrossRef>,
        genres: List<GenreEntity>,
        genreRefs: List<AnimeGenreCrossRef>
    ) {
        events += "applyLibrary"
        this.deletedKitsuIds = deletedKitsuIds
        this.deletedThemeIds = deletedThemeIds
        this.upsertedAnime = anime
        this.upsertedThemes = themes
        this.themeModes = themeModes
        this.artistRefs = artistRefs
        this.genres = genres
        this.genreRefs = genreRefs
    }

    override suspend fun applySongPrefs(preferences: List<SongPreferenceEntity>) {
        songPreferences = preferences
    }

    override suspend fun replaceMusicCatalog(snapshot: MusicCatalogSnapshot) {
        musicCatalog = snapshot
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
        deletedPlaylistIds: List<Long>,
        deletedPlaylists: List<PlaylistEntity>,
        pruneMissingAutoPlaylists: Boolean,
        playlists: List<PlaylistEntity>,
        entries: List<PlaylistEntryEntity>,
        dynamicSpecs: List<DynamicPlaylistSpecEntity>
    ) {
        events += "applyAuto"
        this.deletedPlaylistIds = deletedPlaylistIds
        this.pruneMissingAutoPlaylists = pruneMissingAutoPlaylists
        this.autoPlaylists = playlists
        this.autoEntries = entries
        this.dynamicSpecs = dynamicSpecs
    }
}

private fun activeSessionStateManager(): SessionStateManager {
    val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
        save(ServerSession("tok", "uid", "n"))
    }
    return SessionStateManager(tokenStore)
}

private fun testMoshi(): Moshi {
    val filterNodeFactory = PolymorphicJsonAdapterFactory.of(FilterNode::class.java, "type")
        .withSubtype(FilterNode.And::class.java, "and")
        .withSubtype(FilterNode.Or::class.java, "or")
        .withSubtype(FilterNode.Not::class.java, "not")
        .withSubtype(FilterNode.GenreIn::class.java, "genre_in")
        .withSubtype(FilterNode.AiredOn::class.java, "aired_on")
        .withSubtype(FilterNode.SeasonIn::class.java, "season_in")
        .withSubtype(FilterNode.SubtypeIn::class.java, "subtype_in")
        .withSubtype(FilterNode.AverageRatingGte::class.java, "average_rating_gte")
        .withSubtype(FilterNode.UserRatingGte::class.java, "user_rating_gte")
        .withSubtype(FilterNode.WatchingStatusIn::class.java, "watching_status_in")
        .withSubtype(FilterNode.WatchedOn::class.java, "watched_on")
        .withSubtype(FilterNode.ThemeTypeIn::class.java, "theme_type_in")
        .withSubtype(FilterNode.ArtistIn::class.java, "artist_in")
        .withSubtype(FilterNode.TitleMatches::class.java, "title_matches")
        .withSubtype(FilterNode.SongTitleMatches::class.java, "song_title_matches")
        .withSubtype(FilterNode.Liked::class.java, "liked")
        .withSubtype(FilterNode.Disliked::class.java, "disliked")
        .withSubtype(FilterNode.Downloaded::class.java, "downloaded")
        .withSubtype(FilterNode.PlayCountGte::class.java, "play_count_gte")
        .withSubtype(FilterNode.PlayedOn::class.java, "played_on")
        .withSubtype(FilterNode.AiredBefore::class.java, "aired_before")
        .withSubtype(FilterNode.AiredAfter::class.java, "aired_after")
        .withSubtype(FilterNode.AiredBetween::class.java, "aired_between")
        .withSubtype(FilterNode.LibraryUpdatedAfter::class.java, "library_updated_after")
        .withSubtype(FilterNode.LibraryUpdatedWithin::class.java, "library_updated_within")
        .withSubtype(FilterNode.PlayedSince::class.java, "played_since")
    val dateAnchorFactory = PolymorphicJsonAdapterFactory.of(DateAnchor::class.java, "type")
        .withSubtype(DateAnchor.AbsoluteYear::class.java, "absolute_year")
        .withSubtype(DateAnchor.Relative::class.java, "relative")
    val customRangeFactory = PolymorphicJsonAdapterFactory.of(CustomRange::class.java, "type")
        .withSubtype(CustomRange.Relative::class.java, "relative")
        .withSubtype(CustomRange.Exact::class.java, "exact")
    return Moshi.Builder()
        .add(filterNodeFactory)
        .add(dateAnchorFactory)
        .add(customRangeFactory)
        .add(KotlinJsonAdapterFactory())
        .build()
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
    private val events: MutableList<String> = mutableListOf(),
    private val songPrefsResponse: List<OngakuSongPrefDto>? = null,
    private val musicCatalogResponse: List<OngakuAnimeMusicDto>? = null
) : OngakuApi {
    var requestedSince: Long? = null
    var requestedChangesSince: Long? = null
    var requestedPlaylistSince: Long? = null
    var changesCalled = false
    var playlistsCalled = false
    var autoPlaylistsCalled = false

    override suspend fun changes(since: Long?): OngakuChangesResponse {
        events += "changes"
        changesCalled = true
        requestedChangesSince = since
        return OngakuChangesResponse(
            serverTime = libraryResponse.serverTime,
            anime = libraryResponse.anime,
            themes = libraryResponse.themes,
            prefs = prefsResponse,
            playlists = autoPlaylistResponse,
            songPrefs = songPrefsResponse,
            musicCatalog = musicCatalogResponse
        )
    }

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
    override suspend fun playlists(since: Long?): List<OngakuPlaylistDto> {
        playlistsCalled = true
        requestedPlaylistSince = since
        return autoPlaylistResponse
    }
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> {
        autoPlaylistsCalled = true
        return autoPlaylistResponse.filter { it.isAuto }
    }
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long, opTs: Long?): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
