package com.takeya.animeongaku.data.model

data class KitsuAnimeEntry(
    val id: String,
    val title: String?,
    val titleEn: String? = null,
    val titleRomaji: String? = null,
    val titleJa: String? = null,
    val abbreviatedTitles: List<String> = emptyList(),
    val posterUrl: String? = null,
    val posterUrlLarge: String? = null,
    val coverUrl: String? = null,
    val coverUrlLarge: String? = null,
    val watchingStatus: String? = null,
    val subtype: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val episodeCount: Int? = null,
    val ageRating: String? = null,
    val averageRating: Double? = null,
    val userRating: Double? = null,
    val libraryUpdatedAt: Long? = null,
    val slug: String? = null,
    val genres: List<KitsuGenreData> = emptyList()
)

data class KitsuGenreData(val slug: String, val displayName: String, val source: String)
