package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "download_request")
data class DownloadRequestEntity(
    @PrimaryKey val themeId: Long,
    val status: String,
    val progress: Int = 0,
    val filePath: String? = null,
    val imagePath: String? = null,
    val fileSize: Long = 0,
    val errorMessage: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val workManagerId: String? = null
) {
    companion object {
        const val STATUS_PENDING = "pending"
        const val STATUS_DOWNLOADING = "downloading"
        const val STATUS_COMPLETED = "completed"
        const val STATUS_FAILED = "failed"
        const val STATUS_PAUSED = "paused"
        const val STATUS_WAITING_FOR_WIFI = "waiting_for_wifi"
    }
}
