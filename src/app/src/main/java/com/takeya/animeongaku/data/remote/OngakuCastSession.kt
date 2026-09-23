package com.takeya.animeongaku.data.remote

import retrofit2.http.POST

data class OngakuCastSession(val token: String, val expiresAt: Long)

interface OngakuCastApi {
    @POST("v1/cast/session")
    suspend fun createCastSession(): OngakuCastSession
}
