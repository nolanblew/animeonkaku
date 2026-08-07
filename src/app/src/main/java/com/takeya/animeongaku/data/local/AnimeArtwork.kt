package com.takeya.animeongaku.data.local

/**
 * Sentinel base for kitsu-derived media-route URLs. The host is a placeholder:
 * [com.takeya.animeongaku.network.ServerMediaRebaseInterceptor] rewrites any
 * `/v1/media/...` image request onto the live server base before it is sent, so
 * these URLs resolve against whatever server is configured now.
 *
 * Deriving artwork from [AnimeEntity.kitsuId] decouples display from the stored
 * absolute URL, which can be stale (frozen to an old host at sync time) or absent
 * (e.g. anime referenced only by search results or playlists, never carried by the
 * library delta, so their artwork is never backfilled). The image route is
 * deterministic and the server owns availability (404 when it genuinely has no art).
 */
private const val MEDIA_ROUTE_SENTINEL = "https://ongaku.local"

private fun AnimeEntity.animeImageRouteUrl(variant: String): String? =
    kitsuId.takeIf { it.toLongOrNull() != null }
        ?.let { "$MEDIA_ROUTE_SENTINEL/v1/media/images/anime/$it/$variant" }

fun AnimeEntity.primaryArtworkUrl(): String? =
    animeImageRouteUrl("cover")
        ?: coverUrl?.takeIf { it.isNotBlank() }
        ?: thumbnailUrl?.takeIf { it.isNotBlank() }

fun AnimeEntity.backgroundArtworkUrl(): String? =
    animeImageRouteUrl("poster")
        ?: thumbnailUrl?.takeIf { it.isNotBlank() }
        ?: coverUrl?.takeIf { it.isNotBlank() }

/**
 * Ordered list of artwork URLs to try in sequence. Server media routes come first.
 * FallbackAsyncImage retries stale or unavailable stored URLs after the server route fails.
 */
fun AnimeEntity.primaryArtworkUrls(): List<String> = listOfNotNull(
    animeImageRouteUrl("cover"),
    animeImageRouteUrl("poster"),
    coverUrl?.takeIf { it.isNotBlank() },
    coverUrlLarge?.takeIf { it.isNotBlank() },
    thumbnailUrl?.takeIf { it.isNotBlank() },
    thumbnailUrlLarge?.takeIf { it.isNotBlank() }
).distinct()

fun AnimeEntity.backgroundArtworkUrls(): List<String> = listOfNotNull(
    animeImageRouteUrl("poster"),
    animeImageRouteUrl("cover"),
    thumbnailUrl?.takeIf { it.isNotBlank() },
    thumbnailUrlLarge?.takeIf { it.isNotBlank() },
    coverUrl?.takeIf { it.isNotBlank() },
    coverUrlLarge?.takeIf { it.isNotBlank() }
).distinct()
