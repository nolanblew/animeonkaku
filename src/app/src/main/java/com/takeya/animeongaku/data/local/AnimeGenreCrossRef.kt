package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

@Entity(
    tableName = "anime_genres",
    primaryKeys = ["kitsuId", "slug"],
    foreignKeys = [
        ForeignKey(
            entity = AnimeEntity::class,
            parentColumns = ["kitsuId"],
            childColumns = ["kitsuId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("slug")]
)
data class AnimeGenreCrossRef(
    val kitsuId: String,
    val slug: String
)
