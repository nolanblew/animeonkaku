package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "themes")
data class ThemeEntity(
    @PrimaryKey val id: Long,
    val animeId: Long?,
    val title: String,
    val artistName: String?,
    val audioUrl: String,
    val videoUrl: String?,
    val isDownloaded: Boolean,
    val localFilePath: String?,
    val themeType: String? = null
)
