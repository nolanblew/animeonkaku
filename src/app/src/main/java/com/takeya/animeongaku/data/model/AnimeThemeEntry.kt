package com.takeya.animeongaku.data.model

data class AnimeThemeEntry(
    val animeId: String,
    val animeName: String? = null,
    val themeId: String,
    val title: String,
    val artist: String?,
    val audioUrl: String,
    val videoUrl: String?,
    val themeType: String? = null,
    val artists: List<ArtistCredit> = emptyList()
)

data class ArtistCredit(
    val name: String,
    val asCharacter: String? = null,
    val alias: String? = null
)
