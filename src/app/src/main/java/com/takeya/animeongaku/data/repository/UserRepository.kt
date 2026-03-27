package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.KitsuAnimeEntry

data class LibrarySyncProgress(
    val page: Int,
    val totalPages: Int?,
    val fetchedCount: Int,
    val totalCount: Int?,
    val isLastPage: Boolean
)

interface UserRepository {
    suspend fun findUserId(username: String): String?
    suspend fun getAuthenticatedUserId(): String?

    suspend fun getLibraryEntries(
        userId: String,
        onProgress: (LibrarySyncProgress) -> Unit = {}
    ): List<KitsuAnimeEntry>

    suspend fun getLibraryEntriesDelta(
        userId: String,
        knownKitsuIds: Set<String>,
        onProgress: (LibrarySyncProgress) -> Unit = {}
    ): List<KitsuAnimeEntry>

    suspend fun getLibraryEntriesUpdatedSince(
        userId: String,
        sinceMillis: Long
    ): List<KitsuAnimeEntry>

    suspend fun getCurrentlyWatchingEntries(
        userId: String
    ): List<KitsuAnimeEntry>

    suspend fun getAnimeDetails(ids: List<String>): List<KitsuAnimeEntry>

    suspend fun getAnimeMappings(kitsuIds: List<String>): Map<String, Map<String, String>>

    suspend fun searchKitsuAnime(query: String): List<KitsuAnimeEntry>
}
