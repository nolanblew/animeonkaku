package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "anime")
data class AnimeEntity(
    @PrimaryKey val kitsuId: String,
    val animeThemesId: Long?,
    val title: String?,
    val titleEn: String? = null,
    val titleRomaji: String? = null,
    val titleJa: String? = null,
    val thumbnailUrl: String?,
    val coverUrl: String?,
    val syncedAt: Long,
    val isManuallyAdded: Boolean = false
)
