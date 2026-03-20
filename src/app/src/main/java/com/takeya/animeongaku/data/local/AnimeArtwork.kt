package com.takeya.animeongaku.data.local

fun AnimeEntity.primaryArtworkUrl(): String? =
    coverUrl?.takeIf { it.isNotBlank() } ?: thumbnailUrl?.takeIf { it.isNotBlank() }

fun AnimeEntity.backgroundArtworkUrl(): String? =
    thumbnailUrl?.takeIf { it.isNotBlank() } ?: coverUrl?.takeIf { it.isNotBlank() }

/**
 * Ordered list of artwork URLs to try in sequence (highest quality first, fallbacks after).
 * Cover original → cover large → poster original → poster large → null entries skipped.
 * Used by FallbackAsyncImage to retry with the next URL on a load error.
 */
fun AnimeEntity.primaryArtworkUrls(): List<String> = listOfNotNull(
    coverUrl?.takeIf { it.isNotBlank() },
    coverUrlLarge?.takeIf { it.isNotBlank() },
    thumbnailUrl?.takeIf { it.isNotBlank() },
    thumbnailUrlLarge?.takeIf { it.isNotBlank() }
).distinct()

fun AnimeEntity.backgroundArtworkUrls(): List<String> = listOfNotNull(
    thumbnailUrl?.takeIf { it.isNotBlank() },
    thumbnailUrlLarge?.takeIf { it.isNotBlank() },
    coverUrl?.takeIf { it.isNotBlank() },
    coverUrlLarge?.takeIf { it.isNotBlank() }
).distinct()
