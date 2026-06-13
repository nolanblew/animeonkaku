package com.takeya.animeongaku.data.remote

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface OngakuApi {
    @POST("v1/auth/login")
    suspend fun login(@Body request: OngakuLoginRequest): OngakuLoginResponse

    @POST("v1/auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("v1/auth/me")
    suspend fun me(): OngakuMeResponse

    @DELETE("v1/auth/devices/{id}")
    suspend fun revokeDevice(@Path("id") id: Long): Response<Unit>

    @GET("v1/library")
    suspend fun library(@Query("since") since: Long? = null): OngakuLibraryResponse

    @GET("v1/anime/{kitsuId}")
    suspend fun anime(@Path("kitsuId") kitsuId: String): OngakuAnimeDetailResponse

    @GET("v1/search")
    suspend fun search(@Query("q") query: String): OngakuSearchResponse

    @GET("v1/artists/{slug}")
    suspend fun artist(@Path("slug") slug: String): AnimeThemesSingleArtistResponse

    @POST("v1/library/anime")
    suspend fun addAnime(@Body request: OngakuManualAnimeRequest): OngakuManualAnimeResponse

    @DELETE("v1/library/anime/{kitsuId}")
    suspend fun removeAnime(@Path("kitsuId") kitsuId: String): Response<Unit>

    @GET("v1/prefs/themes")
    suspend fun themePrefs(): List<OngakuThemePrefDto>

    @PUT("v1/prefs/themes/{themeId}")
    suspend fun updateThemePref(
        @Path("themeId") themeId: Long,
        @Body request: OngakuThemePrefPatch
    ): OngakuThemePrefDto

    @POST("v1/plays")
    suspend fun recordPlays(@Body plays: List<OngakuPlayEvent>): OngakuPlayAcceptedResponse

    @GET("v1/playlists")
    suspend fun playlists(): List<OngakuPlaylistDto>

    @GET("v1/playlists/auto")
    suspend fun autoPlaylists(): List<OngakuPlaylistDto>

    @POST("v1/playlists")
    suspend fun createPlaylist(@Body request: OngakuPlaylistRequest): OngakuPlaylistResponse

    @PUT("v1/playlists/{id}")
    suspend fun updatePlaylist(
        @Path("id") id: Long,
        @Body request: OngakuPlaylistRequest
    ): OngakuPlaylistResponse

    @PUT("v1/playlists/{id}/spec")
    suspend fun updatePlaylistSpec(
        @Path("id") id: Long,
        @Body spec: Any
    ): OngakuPlaylistResponse

    @DELETE("v1/playlists/{id}")
    suspend fun deletePlaylist(@Path("id") id: Long): Response<Unit>

    @POST("v1/media/audio/{themeId}/request")
    suspend fun requestAudio(@Path("themeId") themeId: Long): OngakuAudioRequestResponse

    @POST("v1/sync")
    suspend fun startSync(@Body request: OngakuSyncRequest = OngakuSyncRequest()): OngakuSyncQueuedResponse

    @GET("v1/sync/status")
    suspend fun syncStatus(): OngakuSyncStatusResponse
}
