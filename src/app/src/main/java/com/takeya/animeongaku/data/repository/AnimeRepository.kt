package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.model.AnimeThemeEntry

data class AnimeThemeSyncResult(
    val themes: List<AnimeThemeEntry>,
    val animeMappings: Map<String, Long>
)

interface AnimeRepository {
    suspend fun mapKitsuThemes(kitsuIds: List<String>): AnimeThemeSyncResult
}
