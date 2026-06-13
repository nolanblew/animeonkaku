package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "pending_plays",
    indices = [Index(value = ["themeId"])]
)
data class PendingPlayEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val themeId: Long,
    val playedAt: Long,
    val createdAt: Long = System.currentTimeMillis()
)
