package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "theme_artist",
    primaryKeys = ["themeId", "artistName"],
    indices = [Index("artistName")]
)
data class ThemeArtistCrossRef(
    val themeId: Long,
    val artistName: String,
    val asCharacter: String? = null,
    val alias: String? = null
)
