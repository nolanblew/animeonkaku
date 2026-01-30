package com.takeya.animeongaku.data.model

data class AnimeThemeEntry(
    val animeId: String,
    val themeId: String,
    val title: String,
    val artist: String?,
    val audioUrl: String,
    val videoUrl: String?
)
