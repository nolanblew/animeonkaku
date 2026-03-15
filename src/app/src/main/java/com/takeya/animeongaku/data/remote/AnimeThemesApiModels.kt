package com.takeya.animeongaku.data.remote

import com.squareup.moshi.Json

data class AnimeThemesApiResponse(
    @Json(name = "anime")
    val anime: List<ApiAnime> = emptyList(),
    val links: ApiPaginationLinks? = null
)

data class ApiPaginationLinks(
    val first: String? = null,
    val last: String? = null,
    val prev: String? = null,
    val next: String? = null
)

data class AnimeThemesArtistResponse(
    @Json(name = "artists")
    val artists: List<ApiArtistProfile> = emptyList()
)

data class ApiAnime(
    val id: Long? = null,
    val name: String? = null,
    val resources: List<ApiResource> = emptyList(),
    val animethemes: List<ApiTheme> = emptyList(),
    val images: List<ApiAnimeImage> = emptyList(),
    @Json(name = "animesynonyms")
    val synonyms: List<ApiAnimeSynonym> = emptyList()
)

data class ApiAnimeImage(
    val facet: String? = null,
    val link: String? = null,
    val path: String? = null
)

data class ApiAnimeSynonym(
    val text: String? = null,
    val type: String? = null
)

data class ApiResource(
    @Json(name = "external_id")
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
    val name: String? = null,
    val slug: String? = null,
    val artistsong: ApiArtistSong? = null
)

data class ApiArtistSong(
    @Json(name = "as")
    val asCharacter: String? = null,
    val alias: String? = null
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

data class AnimeThemesSearchResponse(
    val search: AnimeThemesSearchData = AnimeThemesSearchData()
)

data class AnimeThemesSearchData(
    val anime: List<ApiAnime> = emptyList(),
    val artists: List<ApiSearchArtist> = emptyList()
)

data class ApiSearchArtist(
    val id: Long? = null,
    val name: String? = null,
    val slug: String? = null,
    val images: List<ApiArtistImage> = emptyList()
)
