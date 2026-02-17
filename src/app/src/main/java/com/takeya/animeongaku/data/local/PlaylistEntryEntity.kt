package com.takeya.animeongaku.data.local

import androidx.room.Entity

@Entity(
    tableName = "playlist_entries",
    primaryKeys = ["playlistId", "themeId"]
)
data class PlaylistEntryEntity(
    val playlistId: Long,
    val themeId: Long,
    val orderIndex: Int
)
