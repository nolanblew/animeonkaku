package com.takeya.animeongaku.data.local

import androidx.room.Embedded
import androidx.room.Entity
import androidx.room.Index

@Entity(
    tableName = "download_items",
    indices = [Index(value = ["itemType", "itemId", "mode"], unique = true)]
)
data class DownloadItemEntity(
    @androidx.room.PrimaryKey val mediaKey: String,
    val itemType: String,
    val itemId: Long,
    val mode: String,
    val status: String,
    val progress: Int = 0,
    val filePath: String? = null,
    val imagePath: String? = null,
    val fileSize: Long = 0,
    val errorMessage: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val workManagerId: String? = null,
    val legacyThemeId: Long? = null,
    @Embedded(prefix = "loudness_")
    val loudness: LoudnessProfile? = null
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_DOWNLOADING = "downloading"
        const val STATUS_RETRYING = "retrying"
        const val STATUS_COMPLETED = "completed"
        const val STATUS_FAILED = "failed"
        const val STATUS_PAUSED = "paused"
        const val STATUS_WAITING_FOR_WIFI = "waiting_for_wifi"

        fun tvSizeMediaKey(themeId: Long): String = "THEME:$themeId:TV_SIZE"
        /** Full Size resolves to the same canonical song bytes as Related Music. */
        fun fullSizeMediaKey(themeId: Long, songId: Long): String = songMediaKey(songId)
        fun songMediaKey(songId: Long): String = "SONG:$songId:AUDIO"
    }
}

@Entity(
    tableName = "download_group_items",
    primaryKeys = ["groupId", "mediaKey"],
    indices = [Index("mediaKey")]
)
data class DownloadGroupItemEntity(
    val groupId: Long,
    val mediaKey: String
)
