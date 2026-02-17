package com.takeya.animeongaku.data.remote

import retrofit2.http.Field
import retrofit2.http.FormUrlEncoded
import retrofit2.http.Headers
import retrofit2.http.POST
import okhttp3.ResponseBody
import retrofit2.Response

interface KitsuAuthApi {
    @Headers(
        "Accept: application/json",
        "Content-Type: application/x-www-form-urlencoded"
    )
    @FormUrlEncoded
    @POST("oauth/token")
    suspend fun login(
        @Field("grant_type") grantType: String,
        @Field("username") username: String,
        @Field("password") password: String,
        @Field("client_id") clientId: String,
        @Field("client_secret") clientSecret: String
    ): Response<ResponseBody>

    @Headers(
        "Accept: application/json",
        "Content-Type: application/x-www-form-urlencoded"
    )
    @FormUrlEncoded
    @POST("oauth/token")
    suspend fun refresh(
        @Field("grant_type") grantType: String,
        @Field("refresh_token") refreshToken: String,
        @Field("client_id") clientId: String,
        @Field("client_secret") clientSecret: String
    ): Response<ResponseBody>
}
