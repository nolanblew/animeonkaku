package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

data class DownloadGroupWithCount(
    val group: DownloadGroupEntity,
    val songCount: Int,
    val completedCount: Int,
    val totalSize: Long
)

@Dao
interface DownloadDao {

    // --- DownloadRequest queries ---

    @Query("SELECT * FROM download_request")
    fun observeAllDownloads(): Flow<List<DownloadRequestEntity>>

    @Query("SELECT * FROM download_request WHERE status = :status")
    fun observeDownloadsByStatus(status: String): Flow<List<DownloadRequestEntity>>

    @Query("SELECT * FROM download_request WHERE themeId = :themeId")
    suspend fun getDownloadForTheme(themeId: Long): DownloadRequestEntity?

    @Query("SELECT * FROM download_request WHERE themeId = :themeId")
    fun observeDownloadForTheme(themeId: Long): Flow<DownloadRequestEntity?>

    @Query("SELECT * FROM download_request WHERE status IN (:statuses)")
    suspend fun getDownloadsByStatuses(statuses: List<String>): List<DownloadRequestEntity>

    @Query("SELECT COALESCE(SUM(fileSize), 0) FROM download_request WHERE status = '${DownloadRequestEntity.STATUS_COMPLETED}'")
    fun observeTotalDownloadSize(): Flow<Long>

    @Query("SELECT COALESCE(SUM(fileSize), 0) FROM download_request WHERE status = '${DownloadRequestEntity.STATUS_COMPLETED}'")
    suspend fun getTotalDownloadSize(): Long

    @Query("SELECT * FROM download_request WHERE status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_FAILED}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')")
    suspend fun getPendingAndFailedDownloads(): List<DownloadRequestEntity>

    @Query("SELECT COUNT(*) FROM download_request WHERE status = '${DownloadRequestEntity.STATUS_COMPLETED}'")
    fun observeCompletedCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM download_request WHERE status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')")
    fun observeActiveCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM download_request WHERE status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')")
    suspend fun getActiveDownloadCount(): Int

    // Batch-aware queries: only count themes in groups that still have active downloads.
    // This excludes old completed downloads from previous sessions.

    @Query("""
        SELECT COUNT(DISTINCT dgt.themeId) FROM download_group_theme dgt
        WHERE dgt.groupId IN (
            SELECT DISTINCT dgt2.groupId FROM download_group_theme dgt2
            INNER JOIN download_request dr ON dgt2.themeId = dr.themeId
            WHERE dr.status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')
        )
    """)
    suspend fun getActiveBatchTotalCount(): Int

    @Query("""
        SELECT COUNT(DISTINCT dgt.themeId) FROM download_group_theme dgt
        INNER JOIN download_request dr ON dgt.themeId = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
        AND dgt.groupId IN (
            SELECT DISTINCT dgt2.groupId FROM download_group_theme dgt2
            INNER JOIN download_request dr2 ON dgt2.themeId = dr2.themeId
            WHERE dr2.status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')
        )
    """)
    suspend fun getActiveBatchCompletedCount(): Int

    @Query("""
        SELECT COUNT(DISTINCT dgt.themeId) FROM download_group_theme dgt
        WHERE dgt.groupId IN (
            SELECT DISTINCT dgt2.groupId FROM download_group_theme dgt2
            INNER JOIN download_request dr ON dgt2.themeId = dr.themeId
            WHERE dr.status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')
        )
    """)
    fun observeActiveBatchTotalCount(): Flow<Int>

    @Query("""
        SELECT COUNT(DISTINCT dgt.themeId) FROM download_group_theme dgt
        INNER JOIN download_request dr ON dgt.themeId = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
        AND dgt.groupId IN (
            SELECT DISTINCT dgt2.groupId FROM download_group_theme dgt2
            INNER JOIN download_request dr2 ON dgt2.themeId = dr2.themeId
            WHERE dr2.status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')
        )
    """)
    fun observeActiveBatchCompletedCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDownload(download: DownloadRequestEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertDownloadIfNotExists(download: DownloadRequestEntity)

    @Update
    suspend fun updateDownload(download: DownloadRequestEntity)

    @Query("UPDATE download_request SET status = :status, updatedAt = :now WHERE themeId = :themeId")
    suspend fun updateStatus(themeId: Long, status: String, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_request SET status = :status, progress = :progress, updatedAt = :now WHERE themeId = :themeId")
    suspend fun updateProgress(themeId: Long, status: String, progress: Int, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_request SET status = '${DownloadRequestEntity.STATUS_COMPLETED}', filePath = :filePath, imagePath = :imagePath, fileSize = :fileSize, progress = 100, updatedAt = :now WHERE themeId = :themeId")
    suspend fun markCompleted(themeId: Long, filePath: String, imagePath: String?, fileSize: Long, now: Long = System.currentTimeMillis())

    @Query("UPDATE download_request SET status = '${DownloadRequestEntity.STATUS_FAILED}', errorMessage = :error, updatedAt = :now WHERE themeId = :themeId")
    suspend fun markFailed(themeId: Long, error: String, now: Long = System.currentTimeMillis())

    @Query("DELETE FROM download_request WHERE themeId = :themeId")
    suspend fun deleteDownload(themeId: Long)

    @Query("DELETE FROM download_request")
    suspend fun deleteAllDownloads()

    @Query("UPDATE download_request SET status = '${DownloadRequestEntity.STATUS_PAUSED}', updatedAt = :now WHERE status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')")
    suspend fun pauseAllActive(now: Long = System.currentTimeMillis())

    // --- DownloadGroup queries ---

    @Query("SELECT * FROM download_group")
    fun observeAllGroups(): Flow<List<DownloadGroupEntity>>

    @Query("SELECT * FROM download_group WHERE groupType = :type AND groupId = :groupId LIMIT 1")
    suspend fun findGroup(type: String, groupId: String): DownloadGroupEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertGroup(group: DownloadGroupEntity): Long

    @Query("DELETE FROM download_group WHERE id = :groupId")
    suspend fun deleteGroup(groupId: Long)

    @Query("DELETE FROM download_group")
    suspend fun deleteAllGroups()

    // --- DownloadGroupTheme queries ---

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertGroupTheme(entity: DownloadGroupThemeEntity)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertGroupThemes(entities: List<DownloadGroupThemeEntity>)

    @Query("SELECT themeId FROM download_group_theme WHERE groupId = :groupId")
    suspend fun getThemeIdsInGroup(groupId: Long): List<Long>

    @Query("SELECT dgt.groupId FROM download_group_theme dgt WHERE dgt.themeId = :themeId")
    suspend fun getGroupIdsForTheme(themeId: Long): List<Long>

    @Query("DELETE FROM download_group_theme WHERE groupId = :groupId")
    suspend fun deleteGroupThemes(groupId: Long)

    @Query("DELETE FROM download_group_theme WHERE groupId = :groupId AND themeId = :themeId")
    suspend fun deleteGroupTheme(groupId: Long, themeId: Long)

    @Query("DELETE FROM download_group_theme")
    suspend fun deleteAllGroupThemes()

    @Query("""
        SELECT COUNT(*) FROM download_group_theme WHERE themeId = :themeId
    """)
    suspend fun countGroupsForTheme(themeId: Long): Int

    // --- Compound queries ---

    @Query("""
        SELECT dr.themeId FROM download_request dr
        INNER JOIN download_group_theme dgt ON dr.themeId = dgt.themeId
        WHERE dgt.groupId = :groupId AND dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    suspend fun getCompletedThemeIdsInGroup(groupId: Long): List<Long>

    @Query("""
        SELECT t.* FROM themes t
        INNER JOIN download_request dr ON t.id = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    fun observeDownloadedThemes(): Flow<List<ThemeEntity>>

    @Query("""
        SELECT themeId FROM download_request
        WHERE status IN ('${DownloadRequestEntity.STATUS_PENDING}', '${DownloadRequestEntity.STATUS_DOWNLOADING}', '${DownloadRequestEntity.STATUS_WAITING_FOR_WIFI}')
    """)
    fun observeDownloadingThemeIds(): Flow<List<Long>>

    @Query("""
        SELECT DISTINCT t.animeId FROM themes t
        INNER JOIN download_request dr ON t.id = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}' AND t.animeId IS NOT NULL
    """)
    fun observeAnimeIdsWithDownloads(): Flow<List<Long>>

    @Query("""
        SELECT DISTINCT ta.artistName FROM theme_artist ta
        INNER JOIN download_request dr ON ta.themeId = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    fun observeArtistNamesWithDownloads(): Flow<List<String>>

    @Query("""
        SELECT DISTINCT pe.playlistId FROM playlist_entries pe
        INNER JOIN download_request dr ON pe.themeId = dr.themeId
        WHERE dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    fun observePlaylistIdsWithDownloads(): Flow<List<Long>>

    @Query("""
        SELECT dr.themeId FROM download_request dr
        INNER JOIN themes t ON dr.themeId = t.id
        WHERE t.animeId = :animeThemesId AND dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    fun observeDownloadedThemeIdsForAnime(animeThemesId: Long): Flow<List<Long>>

    @Query("""
        SELECT dr.themeId FROM download_request dr
        INNER JOIN playlist_entries pe ON dr.themeId = pe.themeId
        WHERE pe.playlistId = :playlistId AND dr.status = '${DownloadRequestEntity.STATUS_COMPLETED}'
    """)
    fun observeDownloadedThemeIdsForPlaylist(playlistId: Long): Flow<List<Long>>
}
