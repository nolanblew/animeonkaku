package com.takeya.animeongaku.data.repository

interface ArtistRepository {
    suspend fun refreshArtistImages(names: List<String>)
}
