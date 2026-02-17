package com.takeya.animeongaku.data.remote

import com.squareup.moshi.Json

data class KitsuAuthRequest(
    @field:Json(name = "grant_type")
    val grantType: String = "password",
    val username: String,
    val password: String,
    @field:Json(name = "client_id")
    val clientId: String,
    @field:Json(name = "client_secret")
    val clientSecret: String
)

data class KitsuRefreshRequest(
    @field:Json(name = "grant_type")
    val grantType: String = "refresh_token",
    @field:Json(name = "refresh_token")
    val refreshToken: String,
    @field:Json(name = "client_id")
    val clientId: String,
    @field:Json(name = "client_secret")
    val clientSecret: String
)

data class KitsuAuthResponse(
    @field:Json(name = "access_token")
    val accessToken: String,
    @field:Json(name = "token_type")
    val tokenType: String,
    @field:Json(name = "expires_in")
    val expiresIn: Long,
    @field:Json(name = "refresh_token")
    val refreshToken: String?,
    @field:Json(name = "created_at")
    val createdAt: Long
)

data class KitsuAuthError(
    val error: String? = null,
    @field:Json(name = "error_description")
    val errorDescription: String? = null
)
