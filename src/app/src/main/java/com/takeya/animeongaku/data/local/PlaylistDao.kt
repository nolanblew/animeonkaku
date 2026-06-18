package com.takeya.animeongaku.data.local

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PlaylistDao {
    @Query(
        """
        SELECT p.*, COUNT(t.id) AS trackCount
        FROM playlists p
        LEFT JOIN playlist_entries pe ON p.id = pe.playlistId
        LEFT JOIN themes t ON t.id = pe.themeId
        WHERE p.deletedAt IS NULL
        GROUP BY p.id
        ORDER BY p.createdAt DESC
        """
    )
    fun observePlaylists(): Flow<List<PlaylistWithCount>>

    @Query("SELECT * FROM playlists WHERE id = :playlistId AND deletedAt IS NULL LIMIT 1")
    fun observePlaylist(playlistId: Long): Flow<PlaylistEntity?>

    @Query(
        """
        SELECT t.*, pe.orderIndex AS orderIndex
        FROM playlist_entries pe
        JOIN themes t ON t.id = pe.themeId
        JOIN playlists p ON p.id = pe.playlistId
        WHERE pe.playlistId = :playlistId
          AND p.deletedAt IS NULL
        ORDER BY pe.orderIndex ASC
        """
    )
    fun observePlaylistTracks(playlistId: Long): Flow<List<PlaylistTrack>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPlaylist(playlist: PlaylistEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertEntries(entries: List<PlaylistEntryEntity>)

    @Query("DELETE FROM playlist_entries WHERE playlistId = :playlistId AND themeId = :themeId")
    suspend fun deleteEntry(playlistId: Long, themeId: Long)

    @Query("SELECT COUNT(*) FROM playlist_entries WHERE playlistId = :playlistId")
    suspend fun countEntries(playlistId: Long): Int

    @Query("DELETE FROM playlists WHERE id = :playlistId")
    suspend fun deletePlaylist(playlistId: Long)

    @Query("DELETE FROM playlist_entries WHERE playlistId = :playlistId")
    suspend fun deletePlaylistEntries(playlistId: Long)

    @Query("UPDATE playlists SET name = :newName WHERE id = :playlistId")
    suspend fun renamePlaylist(playlistId: Long, newName: String)

    @Query("UPDATE playlists SET name = :newName, updatedAt = :updatedAt, deletedAt = NULL WHERE id = :playlistId")
    suspend fun renamePlaylistWithUpdatedAt(playlistId: Long, newName: String, updatedAt: Long)

    @Query("UPDATE playlists SET updatedAt = :updatedAt, deletedAt = NULL WHERE id = :playlistId")
    suspend fun touchPlaylist(playlistId: Long, updatedAt: Long)

    @Query("UPDATE playlists SET updatedAt = :updatedAt, deletedAt = :deletedAt WHERE id = :playlistId")
    suspend fun tombstonePlaylist(playlistId: Long, updatedAt: Long, deletedAt: Long)

    @Query("SELECT * FROM playlists WHERE id = :playlistId AND deletedAt IS NULL LIMIT 1")
    suspend fun getPlaylistById(playlistId: Long): PlaylistEntity?

    @Query("SELECT * FROM playlists WHERE id = :playlistId LIMIT 1")
    suspend fun getPlaylistByIdIncludingDeleted(playlistId: Long): PlaylistEntity?

    @Query("SELECT * FROM playlists WHERE id IN (:playlistIds)")
    suspend fun getPlaylistsByIdsIncludingDeleted(playlistIds: List<Long>): List<PlaylistEntity>

    @Query("SELECT themeId FROM playlist_entries WHERE playlistId = :playlistId ORDER BY orderIndex ASC")
    suspend fun getThemeIdsInPlaylist(playlistId: Long): List<Long>

    @Query("SELECT id FROM playlists WHERE name = :name AND deletedAt IS NULL LIMIT 1")
    suspend fun findPlaylistByName(name: String): Long?

    @Query("UPDATE playlists SET isAuto = 1 WHERE id = :playlistId")
    suspend fun markPlaylistAsAuto(playlistId: Long)

    @Query("SELECT * FROM playlists WHERE isAuto = 1 AND name = :name AND deletedAt IS NULL LIMIT 1")
    suspend fun findAutoPlaylistByName(name: String): PlaylistEntity?

    @Query("SELECT id FROM playlists WHERE isAuto = 1 AND deletedAt IS NULL")
    suspend fun getAutoPlaylistIds(): List<Long>

    @Query("SELECT * FROM playlists WHERE isAuto = 0 AND deletedAt IS NULL ORDER BY createdAt ASC")
    suspend fun getManualPlaylists(): List<PlaylistEntity>

    @Query("""
        SELECT a.coverUrl, a.thumbnailUrl
        FROM playlist_entries pe
        JOIN playlists p ON p.id = pe.playlistId
        JOIN themes t ON t.id = pe.themeId
        JOIN anime a ON a.animeThemesId = t.animeId
        WHERE pe.playlistId = :playlistId
          AND p.deletedAt IS NULL
          AND (NULLIF(a.coverUrl, '') IS NOT NULL OR NULLIF(a.thumbnailUrl, '') IS NOT NULL)
        GROUP BY a.animeThemesId
        ORDER BY MIN(pe.orderIndex)
        LIMIT 4
    """)
    suspend fun getPlaylistCoverUrls(playlistId: Long): List<PlaylistSlotUrls>

    @Query("""
        SELECT a.coverUrl, a.thumbnailUrl
        FROM playlist_entries pe
        JOIN playlists p ON p.id = pe.playlistId
        JOIN themes t ON t.id = pe.themeId
        JOIN anime a ON a.animeThemesId = t.animeId
        WHERE pe.playlistId = :playlistId
          AND p.deletedAt IS NULL
          AND (NULLIF(a.coverUrl, '') IS NOT NULL OR NULLIF(a.thumbnailUrl, '') IS NOT NULL)
        GROUP BY a.animeThemesId
        ORDER BY MIN(pe.orderIndex)
        LIMIT 4
    """)
    fun observePlaylistCoverUrls(playlistId: Long): Flow<List<PlaylistSlotUrls>>

    @Query("""
        SELECT pe.playlistId, a.coverUrl, a.thumbnailUrl
        FROM playlist_entries pe
        JOIN playlists p ON p.id = pe.playlistId
        JOIN themes t ON t.id = pe.themeId
        JOIN anime a ON a.animeThemesId = t.animeId
        WHERE (NULLIF(a.coverUrl, '') IS NOT NULL OR NULLIF(a.thumbnailUrl, '') IS NOT NULL)
          AND p.deletedAt IS NULL
        GROUP BY pe.playlistId, a.animeThemesId
        ORDER BY pe.playlistId, MIN(pe.orderIndex)
    """)
    fun observeAllPlaylistCoverUrls(): Flow<List<PlaylistCoverRow>>

    @Query("""
        SELECT p.*, COUNT(t.id) AS trackCount
        FROM playlists p
        LEFT JOIN playlist_entries pe ON p.id = pe.playlistId
        LEFT JOIN themes t ON t.id = pe.themeId
        WHERE p.name LIKE '%' || :query || '%'
          AND p.deletedAt IS NULL
        GROUP BY p.id
        ORDER BY p.createdAt DESC
        LIMIT 50
    """)
    fun searchPlaylists(query: String): Flow<List<PlaylistWithCount>>
}

data class PlaylistCoverRow(
    @ColumnInfo(name = "playlistId") val playlistId: Long,
    @ColumnInfo(name = "coverUrl") val coverUrl: String?,
    @ColumnInfo(name = "thumbnailUrl") val thumbnailUrl: String?
)

data class PlaylistSlotUrls(
    @ColumnInfo(name = "coverUrl") val coverUrl: String?,
    @ColumnInfo(name = "thumbnailUrl") val thumbnailUrl: String?
)

data class PlaylistWithCount(
    @Embedded val playlist: PlaylistEntity,
    @ColumnInfo(name = "trackCount") val trackCount: Int
)

data class PlaylistTrack(
    @Embedded val theme: ThemeEntity,
    @ColumnInfo(name = "orderIndex") val orderIndex: Int
)
