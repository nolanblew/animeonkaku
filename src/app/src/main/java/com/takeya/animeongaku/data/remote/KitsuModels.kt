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
    val name: String? = null
)

data class KitsuLibraryResponse(
    val data: List<KitsuLibraryEntry> = emptyList(),
    val included: List<KitsuAnime> = emptyList()
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
    val attributes: KitsuAnimeAttributes? = null
)

data class KitsuAnimeAttributes(
    @field:Json(name = "canonicalTitle")
    val canonicalTitle: String? = null,
    val titles: Map<String, String>? = null
)
