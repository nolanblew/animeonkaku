package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.KitsuAnimeEntry

data class AnimeThemeSyncResult(
    val themes: List<AnimeThemeEntry>,
    val animeMappings: Map<String, Long>
)

data class ThemeMappingProgress(
    val batchIndex: Int,
    val totalBatches: Int,
    val themesCount: Int
)

data class FallbackSearchResult(
    val animeThemesId: Long?,
    val themes: List<AnimeThemeEntry>
)

interface AnimeRepository {
    suspend fun mapKitsuThemes(
        kitsuEntries: List<KitsuAnimeEntry>,
        onProgress: (ThemeMappingProgress) -> Unit = {}
    ): AnimeThemeSyncResult

    suspend fun searchAnimeThemes(query: String): List<AnimeThemeEntry>

    suspend fun fallbackSearchByTitle(titles: List<String>): FallbackSearchResult

    suspend fun fetchAnimeByExternalIds(
        site: String,
        externalIds: List<String>
    ): AnimeThemeSyncResult
}
