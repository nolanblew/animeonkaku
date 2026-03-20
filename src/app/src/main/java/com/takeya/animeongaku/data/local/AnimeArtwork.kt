package com.takeya.animeongaku.data.local

fun AnimeEntity.primaryArtworkUrl(): String? =
    coverUrl?.takeIf { it.isNotBlank() } ?: thumbnailUrl?.takeIf { it.isNotBlank() }

fun AnimeEntity.backgroundArtworkUrl(): String? =
    thumbnailUrl?.takeIf { it.isNotBlank() } ?: coverUrl?.takeIf { it.isNotBlank() }
