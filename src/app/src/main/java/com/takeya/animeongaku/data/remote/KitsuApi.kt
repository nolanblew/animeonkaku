package com.takeya.animeongaku.data.remote

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface KitsuApi {
    @GET("users")
    suspend fun findUser(
        @Query("filter[slug]") username: String
    ): KitsuUserResponse

    @GET("users")
    suspend fun getSelfUser(
        @Query("filter[self]") self: Boolean = true
    ): KitsuUserResponse

    @GET("users/{id}/library-entries")
    suspend fun getLibraryEntries(
        @Path("id") userId: String,
        @Query("filter[status]") status: String = "current,completed",
        @Query("include") include: String = "anime",
        @Query("fields[anime]") fields: String = "canonicalTitle,titles,abbreviatedTitles,posterImage,coverImage",
        @Query("sort") sort: String = "-updatedAt",
        @Query("page[limit]") limit: Int = 500,
        @Query("page[offset]") offset: Int = 0
    ): KitsuLibraryResponse

    @GET("anime")
    suspend fun getAnimeByIds(
        @Query("filter[id]") ids: String,
        @Query("fields[anime]") fields: String = "canonicalTitle,titles,abbreviatedTitles,posterImage,coverImage",
        @Query("page[limit]") limit: Int = 20
    ): KitsuAnimeResponse

    @GET("anime")
    suspend fun getAnimeWithMappings(
        @Query("filter[id]") ids: String,
        @Query("include") include: String = "mappings",
        @Query("fields[anime]") fields: String = "canonicalTitle,titles",
        @Query("page[limit]") limit: Int = 20
    ): KitsuAnimeWithMappingsResponse
}
