package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "download_group")
data class DownloadGroupEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val groupType: String,
    val groupId: String,
    val label: String,
    val createdAt: Long = System.currentTimeMillis()
) {
    companion object {
        const val TYPE_ANIME = "anime"
        const val TYPE_PLAYLIST = "playlist"
        const val TYPE_SINGLE = "single"
    }
}

@Entity(
    tableName = "download_group_theme",
    primaryKeys = ["groupId", "themeId"]
)
data class DownloadGroupThemeEntity(
    val groupId: Long,
    val themeId: Long
)
