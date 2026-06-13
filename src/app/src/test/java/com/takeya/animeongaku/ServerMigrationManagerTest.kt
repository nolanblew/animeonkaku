package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.DateAnchor
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
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
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.ServerMigrationManager
import com.takeya.animeongaku.sync.ServerMigrationSkipReason
import com.takeya.animeongaku.sync.ServerMigrationStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response

class ServerMigrationManagerTest {
    @Test
    fun `migration skips until server is configured and session exists`() = runBlocking {
        val api = MigrationRecordingOngakuApi()
        val manager = serverMigrationManager(
            settings = ServerSettingsStore(FakeSharedPreferences()),
            api = api,
            session = null
        )

        val result = manager.migrateIfNeeded()

        assertFalse(result.migrated)
        assertEquals(ServerMigrationSkipReason.NotReady, result.skipReason)
        assertFalse(api.anyWriteCalled)
    }

    @Test
    fun `migration uploads prefs play totals manual playlists and dynamic specs once`() = runBlocking {
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val api = MigrationRecordingOngakuApi()
        val manager = serverMigrationManager(
            settings = settings,
            api = api,
            session = ServerSession("token", "123", "nblewtest"),
            preferences = listOf(UserPreferenceEntity(themeId = 10L, isLiked = true, isDisliked = false)),
            playCounts = listOf(PlayCountEntity(themeId = 10L, playCount = 3, lastPlayedAt = 1000L)),
            playlists = listOf(PlaylistEntity(id = 7L, name = "Manual", createdAt = 1L, isAuto = false)),
            playlistEntries = mapOf(7L to listOf(10L, 11L)),
            specs = listOf(
                DynamicPlaylistSpecEntity(
                    playlistId = 7L,
                    filterJson = """{"type":"liked"}""",
                    mode = "AUTO",
                    createdMode = "SIMPLE",
                    sortJson = """{"orders":[]}""",
                    simpleStateJson = """{"rows":[]}"""
                )
            )
        )

        val result = manager.migrateIfNeeded()
        val second = manager.migrateIfNeeded()

        assertTrue(result.migrated)
        assertEquals(1, result.uploadedPrefs)
        assertEquals(3, result.uploadedPlayEvents)
        assertEquals(1, result.uploadedPlaylists)
        assertEquals(1, result.uploadedSpecs)
        assertEquals(OngakuThemePrefPatch(liked = true, disliked = false), api.prefWrites.single().second)
        assertEquals(listOf(10L, 10L, 10L), api.playEvents.map { it.themeId })
        assertEquals(OngakuPlaylistRequest(name = "Manual", entries = listOf(10L, 11L)), api.createdPlaylists.single())
        assertEquals(
            mapOf(
                "filterJson" to mapOf("type" to "liked"),
                "mode" to "AUTO",
                "createdMode" to "SIMPLE",
                "sortJson" to mapOf("orders" to emptyList<Any>()),
                "simpleStateJson" to mapOf("rows" to emptyList<Any>()),
                "schemaVersion" to 1
            ),
            api.updatedSpecs.single().second
        )
        assertTrue(settings.isServerMigrationComplete)
        assertFalse(second.migrated)
        assertEquals(ServerMigrationSkipReason.AlreadyComplete, second.skipReason)
        assertEquals(1, api.createPlaylistCallCount)
    }

    private fun serverMigrationManager(
        settings: ServerSettingsStore,
        api: MigrationRecordingOngakuApi,
        session: ServerSession?,
        preferences: List<UserPreferenceEntity> = emptyList(),
        playCounts: List<PlayCountEntity> = emptyList(),
        playlists: List<PlaylistEntity> = emptyList(),
        playlistEntries: Map<Long, List<Long>> = emptyMap(),
        specs: List<DynamicPlaylistSpecEntity> = emptyList()
    ): ServerMigrationManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences())
        if (session != null) tokenStore.save(session)
        return ServerMigrationManager(
            settingsStore = settings,
            tokenStore = tokenStore,
            store = FakeServerMigrationStore(
                preferences = preferences,
                playCounts = playCounts,
                playlists = playlists,
                playlistEntries = playlistEntries,
                specs = specs
            ),
            ongakuApi = api,
            moshi = testMoshi()
        )
    }
}

private class FakeServerMigrationStore(
    private val preferences: List<UserPreferenceEntity>,
    private val playCounts: List<PlayCountEntity>,
    private val playlists: List<PlaylistEntity>,
    private val playlistEntries: Map<Long, List<Long>>,
    private val specs: List<DynamicPlaylistSpecEntity>
) : ServerMigrationStore {
    override suspend fun preferences(): List<UserPreferenceEntity> = preferences
    override suspend fun playCounts(): List<PlayCountEntity> = playCounts
    override suspend fun manualPlaylists(): List<PlaylistEntity> = playlists
    override suspend fun themeIdsInPlaylist(playlistId: Long): List<Long> = playlistEntries[playlistId].orEmpty()
    override suspend fun dynamicSpecs(): List<DynamicPlaylistSpecEntity> = specs
}

private class MigrationRecordingOngakuApi : OngakuApi {
    val prefWrites = mutableListOf<Pair<Long, OngakuThemePrefPatch>>()
    val playEvents = mutableListOf<OngakuPlayEvent>()
    val createdPlaylists = mutableListOf<OngakuPlaylistRequest>()
    val updatedSpecs = mutableListOf<Pair<Long, Any>>()
    val createPlaylistCallCount: Int get() = createdPlaylists.size
    val anyWriteCalled: Boolean
        get() = prefWrites.isNotEmpty() ||
            playEvents.isNotEmpty() ||
            createdPlaylists.isNotEmpty() ||
            updatedSpecs.isNotEmpty()

    override suspend fun updateThemePref(themeId: Long, request: OngakuThemePrefPatch): OngakuThemePrefDto {
        prefWrites += themeId to request
        return OngakuThemePrefDto(
            themeId = themeId,
            liked = request.liked == true,
            disliked = request.disliked == true,
            playCount = 0,
            lastPlayedAt = null
        )
    }

    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse {
        playEvents += plays
        return OngakuPlayAcceptedResponse(plays.size)
    }

    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse {
        createdPlaylists += request
        val id = 900L + createdPlaylists.size
        return OngakuPlaylistResponse(
            OngakuPlaylistDto(
                id = id,
                name = request.name.orEmpty(),
                entries = request.entries.orEmpty(),
                isAuto = false,
                updatedAt = 1L,
                dynamicSpecJson = request.dynamicSpecJson
            )
        )
    }

    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse {
        updatedSpecs += id to spec
        return OngakuPlaylistResponse(
            OngakuPlaylistDto(
                id = id,
                name = "Updated",
                entries = emptyList(),
                isAuto = false,
                updatedAt = 1L,
                dynamicSpecJson = spec
            )
        )
    }

    override suspend fun login(request: OngakuLoginRequest): OngakuLoginResponse = error("unused")
    override suspend fun logout(): Response<Unit> = Response.success(Unit)
    override suspend fun me(): OngakuMeResponse = error("unused")
    override suspend fun revokeDevice(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun library(since: Long?): OngakuLibraryResponse = error("unused")
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): com.takeya.animeongaku.data.remote.OngakuSearchResponse =
        error("unused")
    override suspend fun artist(slug: String): com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse =
        error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun playlists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse =
        error("unused")
    override suspend fun deletePlaylist(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
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
