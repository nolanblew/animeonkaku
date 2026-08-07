package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.OnlineSearchResult

data class AnimeThemeSyncResult(
    val themes: List<AnimeThemeEntry>,
    val animeMappings: Map<String, Long>
)

data class LibrarySyncProgress(
    val page: Int,
    val totalPages: Int?,
    val fetchedCount: Int,
    val totalCount: Int?,
    val isLastPage: Boolean
)

data class ThemeMappingProgress(
    val batchIndex: Int,
    val totalBatches: Int,
    val themesCount: Int
)

interface AnimeRepository {
    suspend fun searchAnimeThemes(query: String): OnlineSearchResult

    suspend fun fetchAnimeByKitsuId(kitsuId: String): AnimeThemeSyncResult

    suspend fun fetchArtistSongs(artistSlug: String): List<AnimeThemeEntry>

    suspend fun fetchArtistSlug(artistName: String): String?
}
