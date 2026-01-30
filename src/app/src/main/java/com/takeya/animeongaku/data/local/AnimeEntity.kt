package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "anime")
data class AnimeEntity(
    @PrimaryKey val kitsuId: String,
    val animeThemesId: Long?,
    val title: String?,
    val thumbnailUrl: String?,
    val syncedAt: Long
)
