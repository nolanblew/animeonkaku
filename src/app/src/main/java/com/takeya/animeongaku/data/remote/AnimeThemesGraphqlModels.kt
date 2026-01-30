package com.takeya.animeongaku.data.remote

import com.squareup.moshi.Json

data class GraphQlRequest(
    val query: String,
    val variables: Map<String, Any?>
)

data class GraphQlResponse<T>(
    val data: T? = null,
    val errors: List<GraphQlError>? = null
)

data class GraphQlError(
    val message: String? = null
)

data class FindAnimeByExternalSiteData(
    @field:Json(name = "findAnimeByExternalSite")
    val anime: List<GqlAnime> = emptyList()
)

data class GqlAnime(
    val id: Int,
    val name: String? = null,
    val resources: GqlResourceConnection? = null,
    @field:Json(name = "animethemes")
    val animeThemes: List<GqlAnimeTheme> = emptyList()
)

data class GqlResourceConnection(
    val nodes: List<GqlExternalResource> = emptyList()
)

data class GqlExternalResource(
    @field:Json(name = "externalId")
    val externalId: Int? = null,
    val site: String? = null
)

data class GqlAnimeTheme(
    val id: Int,
    val type: String? = null,
    val sequence: Int? = null,
    val song: GqlSong? = null,
    @field:Json(name = "animethemeentries")
    val entries: List<GqlAnimeThemeEntry> = emptyList()
)

data class GqlAnimeThemeEntry(
    val id: Int,
    val videos: GqlVideoConnection? = null
)

data class GqlVideoConnection(
    val nodes: List<GqlVideo> = emptyList()
)

data class GqlVideo(
    val link: String? = null,
    val audio: GqlAudio? = null
)

data class GqlAudio(
    val path: String? = null
)

data class GqlSong(
    val title: String? = null,
    val performances: List<GqlPerformance> = emptyList()
)

data class GqlPerformance(
    val artist: GqlArtistUnion? = null
)

data class GqlArtistUnion(
    val name: String? = null,
    val member: GqlArtist? = null
)

data class GqlArtist(
    val name: String? = null
)
