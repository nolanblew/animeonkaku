package com.takeya.animeongaku.data.remote

import com.squareup.moshi.Json


data class KitsuUserResponse(
    val data: List<KitsuUser> = emptyList()
)

data class KitsuUser(
    val id: String,
    val attributes: KitsuUserAttributes? = null
)

data class KitsuUserAttributes(
    val name: String? = null,
    val slug: String? = null
)

data class KitsuLibraryResponse(
    val data: List<KitsuLibraryEntry> = emptyList(),
    val included: List<KitsuAnime> = emptyList(),
    val meta: KitsuMeta? = null
)

data class KitsuAnimeResponse(
    val data: List<KitsuAnime> = emptyList()
)

data class KitsuMeta(
    val count: Int? = null
)

data class KitsuLibraryEntry(
    val id: String,
    val relationships: KitsuRelationships? = null
)

data class KitsuRelationships(
    val anime: KitsuRelatedData? = null
)

data class KitsuRelatedData(
    val data: KitsuRelationshipData? = null
)

data class KitsuRelationshipData(
    val id: String? = null,
    val type: String? = null
)

data class KitsuAnime(
    val id: String,
    val attributes: KitsuAnimeAttributes? = null,
    val relationships: KitsuAnimeRelationships? = null
)

data class KitsuAnimeRelationships(
    val mappings: KitsuRelatedListData? = null
)

data class KitsuRelatedListData(
    val data: List<KitsuRelationshipData> = emptyList()
)

data class KitsuAnimeAttributes(
    @field:Json(name = "canonicalTitle")
    val canonicalTitle: String? = null,
    val titles: Map<String, String>? = null,
    val abbreviatedTitles: List<String>? = null,
    val posterImage: KitsuImageSet? = null,
    val coverImage: KitsuImageSet? = null
)

data class KitsuAnimeWithMappingsResponse(
    val data: List<KitsuAnime> = emptyList(),
    val included: List<KitsuMapping> = emptyList()
)

data class KitsuMapping(
    val id: String,
    val type: String? = null,
    val attributes: KitsuMappingAttributes? = null
)

data class KitsuMappingAttributes(
    @field:Json(name = "externalSite")
    val externalSite: String? = null,
    @field:Json(name = "externalId")
    val externalId: String? = null
)

data class KitsuImageSet(
    val tiny: String? = null,
    val small: String? = null,
    val medium: String? = null,
    val large: String? = null,
    val original: String? = null
)
