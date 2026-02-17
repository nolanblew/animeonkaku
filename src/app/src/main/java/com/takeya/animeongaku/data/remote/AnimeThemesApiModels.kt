package com.takeya.animeongaku.data.remote

import com.squareup.moshi.Json

data class AnimeThemesApiResponse(
    @field:Json(name = "anime")
    val anime: List<ApiAnime> = emptyList()
)

data class AnimeThemesArtistResponse(
    @field:Json(name = "artists")
    val artists: List<ApiArtistProfile> = emptyList()
)

data class ApiAnime(
    val id: Long? = null,
    val name: String? = null,
    val resources: List<ApiResource> = emptyList(),
    val animethemes: List<ApiTheme> = emptyList()
)

data class ApiResource(
    @field:Json(name = "external_id")
    val externalId: Any? = null,
    val site: String? = null
)

data class ApiTheme(
    val id: Long? = null,
    val type: String? = null,
    val sequence: Int? = null,
    val song: ApiSong? = null,
    val animethemeentries: List<ApiThemeEntry> = emptyList()
)

data class ApiSong(
    val title: String? = null,
    val artists: List<ApiArtist> = emptyList()
)

data class ApiArtist(
    val name: String? = null
)

data class ApiArtistProfile(
    val id: Long? = null,
    val name: String? = null,
    val images: List<ApiArtistImage> = emptyList()
)

data class ApiArtistImage(
    val facet: String? = null,
    val link: String? = null,
    val path: String? = null
)

data class ApiThemeEntry(
    val videos: List<ApiVideo> = emptyList()
)

data class ApiVideo(
    val link: String? = null,
    val audio: ApiAudio? = null
)

data class ApiAudio(
    val link: String? = null,
    val path: String? = null
)
