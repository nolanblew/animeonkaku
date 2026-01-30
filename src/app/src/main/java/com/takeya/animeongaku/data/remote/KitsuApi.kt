package com.takeya.animeongaku.data.remote

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface KitsuApi {
    @GET("users")
    suspend fun findUser(
        @Query("filter[name]") username: String
    ): KitsuUserResponse

    @GET("users/{id}/library-entries")
    suspend fun getLibraryEntries(
        @Path("id") userId: String,
        @Query("filter[status]") status: String = "current,completed",
        @Query("include") include: String = "anime",
        @Query("page[limit]") limit: Int = 500,
        @Query("page[offset]") offset: Int = 0
    ): KitsuLibraryResponse
}
