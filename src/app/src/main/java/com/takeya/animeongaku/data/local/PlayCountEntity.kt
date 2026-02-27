package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "play_count")
data class PlayCountEntity(
    @PrimaryKey val themeId: Long,
    val playCount: Int = 0,
    val lastPlayedAt: Long = 0L
)
