package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.PrimaryKey

@Entity(
    tableName = "dynamic_playlist_spec",
    foreignKeys = [
        ForeignKey(
            entity = PlaylistEntity::class,
            parentColumns = ["id"],
            childColumns = ["playlistId"],
            onDelete = ForeignKey.CASCADE
        )
    ]
)
data class DynamicPlaylistSpecEntity(
    @PrimaryKey val playlistId: Long,
    val filterJson: String,
    val mode: String,        // "AUTO" | "SNAPSHOT"
    val createdMode: String, // "SIMPLE" | "ADVANCED"
    val lastEvaluatedAt: Long = 0L,
    val lastResultCount: Int = 0,
    val schemaVersion: Int = 1,
    val sortJson: String? = null
)
