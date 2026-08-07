package com.takeya.animeongaku.data.remote

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/** Additive v1 music APIs kept separate so legacy OngakuApi implementations stay binary-safe. */
interface OngakuMusicApi {
    @GET("v1/search")
    suspend fun search(@Query("q") query: String): OngakuSearchResponse

    @GET("v1/anime/{kitsuId}/music")
    suspend fun animeMusic(@Path("kitsuId") kitsuId: String): OngakuAnimeMusicDto

    @GET("v1/music/releases/{releaseId}")
    suspend fun musicRelease(@Path("releaseId") releaseId: Long): OngakuMusicReleaseDto

    @GET("v1/prefs/songs")
    suspend fun songPrefs(@Query("since") since: Long? = null): List<OngakuSongPrefDto>

    @PUT("v1/prefs/songs/{songId}")
    suspend fun updateSongPref(
        @Path("songId") songId: Long,
        @Body request: OngakuSongPrefPatch
    ): OngakuSongPrefDto

    @DELETE("v1/prefs/songs/{songId}")
    suspend fun deleteSongPref(
        @Path("songId") songId: Long,
        @Query("opTs") opTs: Long? = null
    ): Response<Unit>

    @POST("v1/plays")
    suspend fun recordActualPlays(@Body plays: List<OngakuActualPlayEvent>): OngakuPlayAcceptedResponse
}
