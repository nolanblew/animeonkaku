package com.takeya.animeongaku.data.model

data class KitsuAnimeEntry(
    val id: String,
    val title: String?,
    val titleEn: String? = null,
    val titleRomaji: String? = null,
    val titleJa: String? = null,
    val abbreviatedTitles: List<String> = emptyList(),
    val posterUrl: String? = null,
    val coverUrl: String? = null,
    val watchingStatus: String? = null
)
