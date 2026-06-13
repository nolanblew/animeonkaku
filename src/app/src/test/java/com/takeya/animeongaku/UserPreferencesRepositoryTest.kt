package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.UserPreferenceDao
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
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.data.server.ServerSettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import retrofit2.Response

class UserPreferencesRepositoryTest {
    @Test
    fun `toggle like writes through to server when server mode is configured`() = runBlocking {
        val dao = FakeUserPreferenceDao()
        val api = RecordingOngakuApi()
        val settings = ServerSettingsStore(FakeSharedPreferences()).apply {
            serverBaseUrl = "http://192.168.1.5:8080/api"
        }
        val repository = UserPreferencesRepository(dao, api, settings)

        repository.toggleLike(themeId = 100L)

        assertEquals(UserPreferenceEntity(themeId = 100L, isLiked = true, isDisliked = false), dao.saved.single())
        assertEquals(100L, api.updatedThemeId)
        assertEquals(OngakuThemePrefPatch(liked = true, disliked = false), api.updatedThemePref)
    }

    @Test
    fun `toggle dislike stays local when server mode is not configured`() = runBlocking {
        val dao = FakeUserPreferenceDao()
        val api = RecordingOngakuApi()
        val settings = ServerSettingsStore(FakeSharedPreferences())
        val repository = UserPreferencesRepository(dao, api, settings)

        repository.toggleDislike(themeId = 100L)

        assertEquals(UserPreferenceEntity(themeId = 100L, isLiked = false, isDisliked = true), dao.saved.single())
        assertFalse(api.updateCalled)
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

private class RecordingOngakuApi : OngakuApi {
    var updateCalled = false
    var updatedThemeId: Long? = null
    var updatedThemePref: OngakuThemePrefPatch? = null

    override suspend fun updateThemePref(
        themeId: Long,
        request: OngakuThemePrefPatch
    ): OngakuThemePrefDto {
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
    override suspend fun anime(kitsuId: String): OngakuAnimeDetailResponse = error("unused")
    override suspend fun search(query: String): com.takeya.animeongaku.data.remote.OngakuSearchResponse =
        error("unused")
    override suspend fun artist(slug: String): com.takeya.animeongaku.data.remote.AnimeThemesSingleArtistResponse =
        error("unused")
    override suspend fun addAnime(request: OngakuManualAnimeRequest): OngakuManualAnimeResponse = error("unused")
    override suspend fun removeAnime(kitsuId: String): Response<Unit> = Response.success(Unit)
    override suspend fun themePrefs(): List<OngakuThemePrefDto> = error("unused")
    override suspend fun recordPlays(plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse = error("unused")
    override suspend fun playlists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun autoPlaylists(): List<OngakuPlaylistDto> = error("unused")
    override suspend fun createPlaylist(request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylist(id: Long, request: OngakuPlaylistRequest): OngakuPlaylistResponse = error("unused")
    override suspend fun updatePlaylistSpec(id: Long, spec: Any): OngakuPlaylistResponse = error("unused")
    override suspend fun deletePlaylist(id: Long): Response<Unit> = Response.success(Unit)
    override suspend fun requestAudio(themeId: Long): OngakuAudioRequestResponse = error("unused")
    override suspend fun startSync(request: OngakuSyncRequest): OngakuSyncQueuedResponse = error("unused")
    override suspend fun syncStatus(): OngakuSyncStatusResponse = error("unused")
}
