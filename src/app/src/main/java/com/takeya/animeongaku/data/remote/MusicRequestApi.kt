package com.takeya.animeongaku.data.remote

import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface MusicRequestApi {
    @POST("v1/anime/{kitsuId}/music-requests")
    suspend fun create(@Path("kitsuId") kitsuId: String): OngakuMusicRequestEnvelope

    @GET("v1/music-requests/{requestId}")
    suspend fun get(@Path("requestId") requestId: String): OngakuMusicRequestEnvelope

    @GET("v1/anime/{kitsuId}/music-requests/latest")
    suspend fun latest(@Path("kitsuId") kitsuId: String): OngakuMusicRequestEnvelope
}

data class OngakuMusicRequestEnvelope(
    val request: OngakuMusicRequestSummaryDto?,
    val replayed: Boolean? = null
)

data class OngakuMusicRequestSummaryDto(
    val id: String,
    val kitsuId: String,
    val state: String,
    val batchCount: Int,
    val counts: OngakuMusicRequestBatchCountsDto,
    val requiresOperatorAction: Boolean,
    val lastUpdatedAt: String,
    val pollAfterSeconds: Int? = null
)

data class OngakuMusicRequestBatchCountsDto(
    val queued: Int = 0,
    val searching: Int = 0,
    val awaitingOperator: Int = 0,
    val downloading: Int = 0,
    val processing: Int = 0,
    val completed: Int = 0,
    val completedWithWarnings: Int = 0,
    val failed: Int = 0,
    val cancelled: Int = 0
)
