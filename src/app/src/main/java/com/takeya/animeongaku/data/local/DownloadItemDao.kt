package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DownloadItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: DownloadItemEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertGroupItems(items: List<DownloadGroupItemEntity>)

    @Query("SELECT * FROM download_items WHERE mediaKey = :mediaKey LIMIT 1")
    suspend fun get(mediaKey: String): DownloadItemEntity?

    @Query("SELECT * FROM download_items WHERE mediaKey IN (:mediaKeys)")
    suspend fun getByMediaKeys(mediaKeys: List<String>): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items")
    fun observeAll(): Flow<List<DownloadItemEntity>>
}
