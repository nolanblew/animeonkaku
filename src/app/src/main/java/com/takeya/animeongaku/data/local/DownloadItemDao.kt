package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

data class DownloadGroupItemRow(
    @androidx.room.Embedded val item: DownloadItemEntity,
    val groupId: Long,
    val groupType: String,
    val externalGroupId: String,
    val groupLabel: String,
    val displayTitle: String
)

@Dao
interface DownloadItemDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(item: DownloadItemEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfAbsent(item: DownloadItemEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertGroupItems(items: List<DownloadGroupItemEntity>)

    @Query("SELECT * FROM download_items WHERE mediaKey = :mediaKey LIMIT 1")
    suspend fun get(mediaKey: String): DownloadItemEntity?

    @Query("SELECT * FROM download_items WHERE mediaKey = :mediaKey LIMIT 1")
    fun observe(mediaKey: String): Flow<DownloadItemEntity?>

    @Query("SELECT * FROM download_items WHERE mediaKey IN (:mediaKeys)")
    suspend fun getByMediaKeys(mediaKeys: List<String>): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items")
    fun observeAll(): Flow<List<DownloadItemEntity>>

    @Query("SELECT * FROM download_items")
    suspend fun getAll(): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items WHERE status IN (:statuses) ORDER BY createdAt, mediaKey")
    suspend fun getByStatuses(statuses: List<String>): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items WHERE status IN ('pending','downloading','retrying','waiting_for_wifi') AND mediaKey NOT IN (:excludedMediaKeys) ORDER BY createdAt LIMIT :limit")
    suspend fun getNextBatch(excludedMediaKeys: List<String>, limit: Int): List<DownloadItemEntity>

    @Query("UPDATE download_items SET status = :status, updatedAt = :now WHERE mediaKey = :mediaKey")
    suspend fun updateStatus(mediaKey: String, status: String, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_items SET status = :status, progress = :progress, updatedAt = :now WHERE mediaKey = :mediaKey")
    suspend fun updateProgress(mediaKey: String, status: String, progress: Int, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_items SET status = 'completed', progress = 100, filePath = :filePath, imagePath = :imagePath, fileSize = :fileSize, errorMessage = NULL, updatedAt = :now WHERE mediaKey = :mediaKey")
    suspend fun markCompleted(mediaKey: String, filePath: String, imagePath: String?, fileSize: Long, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_items SET status = :status, errorMessage = :error, updatedAt = :now WHERE mediaKey = :mediaKey")
    suspend fun markProblem(mediaKey: String, status: String, error: String, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_items SET status = 'paused', updatedAt = :now WHERE status IN ('pending','downloading','retrying','waiting_for_wifi')")
    suspend fun pauseAllActive(now: Long = System.currentTimeMillis())

    @Query("SELECT COALESCE(SUM(fileSize), 0) FROM download_items WHERE status = 'completed'")
    fun observeTotalSize(): Flow<Long>

    @Query("SELECT COUNT(*) FROM download_items WHERE status IN ('pending','downloading','retrying','waiting_for_wifi')")
    fun observeActiveCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM download_items WHERE status = 'completed'")
    fun observeCompletedCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM download_items WHERE status IN ('pending','downloading','retrying','waiting_for_wifi')")
    suspend fun getActiveCount(): Int

    @Query("SELECT mediaKey FROM download_group_items WHERE groupId = :groupId")
    suspend fun getMediaKeysInGroup(groupId: Long): List<String>

    @Query("SELECT groupId FROM download_group_items WHERE mediaKey = :mediaKey")
    suspend fun getGroupIdsForMedia(mediaKey: String): List<Long>

    @Query("SELECT COUNT(*) FROM download_group_items WHERE mediaKey = :mediaKey")
    suspend fun countGroupsForMedia(mediaKey: String): Int

    @Query("DELETE FROM download_group_items WHERE groupId = :groupId AND mediaKey = :mediaKey")
    suspend fun deleteGroupItem(groupId: Long, mediaKey: String)

    @Query("DELETE FROM download_group_items WHERE groupId = :groupId")
    suspend fun deleteGroupItems(groupId: Long)

    @Query("DELETE FROM download_group_items")
    suspend fun deleteAllGroupItems()

    @Query("DELETE FROM download_items WHERE mediaKey = :mediaKey")
    suspend fun delete(mediaKey: String)

    @Query("DELETE FROM download_items")
    suspend fun deleteAll()

    @Query("SELECT di.*, dgi.groupId AS groupId, dg.groupType AS groupType, dg.groupId AS externalGroupId, dg.label AS groupLabel, COALESCE((SELECT title FROM songs WHERE id = di.itemId AND di.itemType = 'SONG'), (SELECT title FROM themes WHERE id = di.itemId AND di.itemType = 'THEME'), 'Audio') AS displayTitle FROM download_items di JOIN download_group_items dgi ON dgi.mediaKey = di.mediaKey JOIN download_group dg ON dg.id = dgi.groupId ORDER BY dg.createdAt, di.createdAt")
    fun observeGroupedItems(): Flow<List<DownloadGroupItemRow>>

    @Query("SELECT DISTINCT itemId FROM download_items WHERE itemType = 'THEME' AND mode = 'TV_SIZE' AND status = 'completed'")
    fun observeCompletedThemeIds(): Flow<List<Long>>

    @Query("SELECT DISTINCT t.animeId FROM themes t JOIN download_items di ON di.itemType = 'THEME' AND di.itemId = t.id WHERE di.mode = 'TV_SIZE' AND di.status = 'completed' AND t.animeId IS NOT NULL")
    fun observeAnimeIdsWithDownloads(): Flow<List<Long>>

    @Query("SELECT DISTINCT CAST(dg.groupId AS INTEGER) FROM download_group dg JOIN download_group_items dgi ON dgi.groupId = dg.id JOIN download_items di ON di.mediaKey = dgi.mediaKey WHERE dg.groupType = 'playlist' AND di.status = 'completed'")
    fun observePlaylistIdsWithDownloads(): Flow<List<Long>>

    @Query("SELECT DISTINCT ta.artistName FROM theme_artist ta JOIN download_items di ON di.itemType = 'THEME' AND di.itemId = ta.themeId WHERE di.status = 'completed'")
    fun observeArtistNamesWithDownloads(): Flow<List<String>>
}
