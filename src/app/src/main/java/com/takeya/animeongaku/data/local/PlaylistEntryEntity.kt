package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "playlist_entries",
    primaryKeys = ["playlistId", "entryId"],
    indices = [Index("itemType", "itemId"), Index("themeId")]
)
data class PlaylistEntryEntity(
    val playlistId: Long,
    /** Transitional projection for old theme-only code. New code uses [itemType]/[itemId]. */
    val themeId: Long? = null,
    val orderIndex: Int,
    val entryId: Long = themeId ?: 0L,
    val itemType: String = ITEM_TYPE_THEME,
    val itemId: Long = themeId ?: 0L,
    val modeOverride: String? = null
) {
    companion object {
        const val ITEM_TYPE_THEME = "THEME"
        const val ITEM_TYPE_SONG = "SONG"
    }
}
