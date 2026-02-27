package com.takeya.animeongaku.data.model

data class OnlineSearchResult(
    val themes: List<AnimeThemeEntry>,
    val anime: List<OnlineAnimeResult>,
    val artists: List<OnlineArtistResult>
)

data class OnlineAnimeResult(
    val animeThemesId: String,
    val name: String,
    val nameEn: String?,
    val coverUrl: String?,
    val kitsuId: String?,
    val themeCount: Int
)

data class OnlineArtistResult(
    val id: Long,
    val name: String,
    val slug: String,
    val imageUrl: String?
)
