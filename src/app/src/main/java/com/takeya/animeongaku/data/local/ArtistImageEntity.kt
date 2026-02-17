package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "artist_images")
data class ArtistImageEntity(
    @PrimaryKey val name: String,
    val imageUrl: String?,
    val updatedAt: Long
)
