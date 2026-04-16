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
    val thumbnailUrlLarge: String? = null,
    val coverUrl: String?,
    val coverUrlLarge: String? = null,
    val syncedAt: Long,
    val isManuallyAdded: Boolean = false,
    val watchingStatus: String? = null,
    val subtype: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val episodeCount: Int? = null,
    val ageRating: String? = null,
    val averageRating: Double? = null,
    val userRating: Double? = null,
    val libraryUpdatedAt: Long? = null,
    val slug: String? = null
)
