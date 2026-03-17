package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "user_preferences")
data class UserPreferenceEntity(
    @PrimaryKey
    val themeId: Long,
    val isLiked: Boolean = false,
    val isDisliked: Boolean = false
)
