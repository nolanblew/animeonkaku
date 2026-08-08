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

    @Query("""
        SELECT DISTINCT di.*
        FROM download_items di
        LEFT JOIN theme_modes tm ON tm.themeId = :themeId
        WHERE (di.itemType = 'THEME' AND di.itemId = :themeId AND di.mode = 'TV_SIZE')
           OR (di.itemType = 'SONG' AND di.itemId = tm.fullSizeSongId AND di.mode = 'AUDIO')
        ORDER BY CASE WHEN di.status = 'completed' THEN 0 ELSE 1 END, di.createdAt
    """)
    fun observeForTheme(themeId: Long): Flow<List<DownloadItemEntity>>

    @Query("SELECT * FROM download_items WHERE mediaKey IN (:mediaKeys)")
    suspend fun getByMediaKeys(mediaKeys: List<String>): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items")
    fun observeAll(): Flow<List<DownloadItemEntity>>

    @Query("SELECT * FROM download_items")
    suspend fun getAll(): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items WHERE status IN (:statuses) ORDER BY createdAt, mediaKey")
    suspend fun getByStatuses(statuses: List<String>): List<DownloadItemEntity>

    @Query("SELECT * FROM download_items WHERE status IN ('pending','downloading','retrying','waiting_for_wifi') AND (:cursorCreatedAt IS NULL OR createdAt > :cursorCreatedAt OR (createdAt = :cursorCreatedAt AND mediaKey > :cursorMediaKey)) ORDER BY createdAt, mediaKey LIMIT :limit")
    suspend fun getNextBatchAfter(
        cursorCreatedAt: Long?,
        cursorMediaKey: String?,
        limit: Int
    ): List<DownloadItemEntity>

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

    @Query("""
        SELECT DISTINCT t.id
        FROM themes t
        LEFT JOIN theme_modes tm ON tm.themeId = t.id
        JOIN download_items di ON (
            (di.itemType = 'THEME' AND di.itemId = t.id AND di.mode = 'TV_SIZE')
            OR (di.itemType = 'SONG' AND di.itemId = tm.fullSizeSongId AND di.mode = 'AUDIO')
        )
        WHERE di.status = 'completed'
    """)
    fun observeCompletedThemeIds(): Flow<List<Long>>

    @Query("""
        SELECT DISTINCT t.animeId
        FROM themes t
        LEFT JOIN theme_modes tm ON tm.themeId = t.id
        JOIN download_items di ON (
            (di.itemType = 'THEME' AND di.itemId = t.id AND di.mode = 'TV_SIZE')
            OR (di.itemType = 'SONG' AND di.itemId = tm.fullSizeSongId AND di.mode = 'AUDIO')
        )
        WHERE di.status = 'completed' AND t.animeId IS NOT NULL
    """)
    fun observeAnimeIdsWithDownloads(): Flow<List<Long>>

    @Query("SELECT DISTINCT CAST(dg.groupId AS INTEGER) FROM download_group dg JOIN download_group_items dgi ON dgi.groupId = dg.id JOIN download_items di ON di.mediaKey = dgi.mediaKey WHERE dg.groupType = 'playlist' AND di.status = 'completed'")
    fun observePlaylistIdsWithDownloads(): Flow<List<Long>>

    @Query("""
        SELECT DISTINCT ta.artistName
        FROM theme_artist ta
        LEFT JOIN theme_modes tm ON tm.themeId = ta.themeId
        JOIN download_items di ON (
            (di.itemType = 'THEME' AND di.itemId = ta.themeId AND di.mode = 'TV_SIZE')
            OR (di.itemType = 'SONG' AND di.itemId = tm.fullSizeSongId AND di.mode = 'AUDIO')
        )
        WHERE di.status = 'completed'
    """)
    fun observeArtistNamesWithDownloads(): Flow<List<String>>

    @Query("""
        SELECT DISTINCT pe.itemId
        FROM playlist_entries pe
        LEFT JOIN theme_modes tm ON tm.themeId = pe.itemId
        JOIN download_items di ON (
            (di.itemType = 'THEME' AND di.itemId = pe.itemId AND di.mode = 'TV_SIZE')
            OR (di.itemType = 'SONG' AND di.itemId = tm.fullSizeSongId AND di.mode = 'AUDIO')
        )
        WHERE pe.playlistId = :playlistId
          AND pe.itemType = 'THEME'
          AND di.status = 'completed'
    """)
    fun observeCompletedThemeIdsForPlaylist(playlistId: Long): Flow<List<Long>>
}
