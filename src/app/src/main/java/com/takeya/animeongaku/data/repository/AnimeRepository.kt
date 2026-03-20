package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.model.KitsuAnimeEntry
import com.takeya.animeongaku.data.model.OnlineSearchResult

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

    suspend fun searchAnimeThemes(query: String): OnlineSearchResult

    suspend fun fallbackSearchByTitle(
        titles: List<String>,
        kitsuId: String = "",
        claimedAnimeThemesIds: Set<Long> = emptySet()
    ): FallbackSearchResult

    suspend fun fetchAnimeByExternalIds(
        site: String,
        externalIds: List<String>
    ): AnimeThemeSyncResult

    suspend fun fetchAnimeById(animeThemesId: Long): List<AnimeThemeEntry>

    suspend fun fetchArtistSongs(artistSlug: String): List<AnimeThemeEntry>

    suspend fun fetchArtistSlug(artistName: String): String?
}
