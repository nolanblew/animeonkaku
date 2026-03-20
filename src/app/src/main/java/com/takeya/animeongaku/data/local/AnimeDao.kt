package com.takeya.animeongaku.data.local

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AnimeDao {
    @Query("SELECT * FROM anime ORDER BY title ASC")
    fun observeAll(): Flow<List<AnimeEntity>>

    @Query("SELECT * FROM anime WHERE animeThemesId IN (:animeThemesIds)")
    fun observeByAnimeThemesIds(animeThemesIds: List<Long>): Flow<List<AnimeEntity>>

    @Query("SELECT * FROM anime WHERE animeThemesId = :animeThemesId LIMIT 1")
    fun observeByAnimeThemesId(animeThemesId: Long): Flow<AnimeEntity?>

    @Query("SELECT * FROM anime WHERE kitsuId = :kitsuId LIMIT 1")
    fun observeByKitsuId(kitsuId: String): Flow<AnimeEntity?>

    @Query("""
        SELECT a.*, 
               (SELECT COUNT(*) FROM themes t WHERE t.animeId = a.animeThemesId) AS themeCount
        FROM anime a
        ORDER BY a.title ASC
    """)
    fun observeAllWithThemeCount(): Flow<List<AnimeWithThemeCount>>

    @Query("""
        SELECT * FROM anime
        WHERE title LIKE '%' || :query || '%'
           OR titleEn LIKE '%' || :query || '%'
           OR titleRomaji LIKE '%' || :query || '%'
           OR titleJa LIKE '%' || :query || '%'
        ORDER BY title ASC
        LIMIT 50
    """)
    fun searchAnime(query: String): Flow<List<AnimeEntity>>

    @Query("SELECT * FROM anime WHERE animeThemesId = :animeThemesId LIMIT 1")
    suspend fun getByAnimeThemesId(animeThemesId: Long): AnimeEntity?

    @Query("SELECT * FROM anime WHERE kitsuId = :kitsuId LIMIT 1")
    suspend fun getByKitsuId(kitsuId: String): AnimeEntity?

    @Query("SELECT * FROM anime WHERE animeThemesId IN (:animeThemesIds)")
    suspend fun getByAnimeThemesIds(animeThemesIds: List<Long>): List<AnimeEntity>

    @Query("SELECT * FROM anime WHERE watchingStatus = :status")
    fun observeByWatchingStatus(status: String): Flow<List<AnimeEntity>>

    @Query("SELECT * FROM anime WHERE watchingStatus = :status")
    suspend fun getByWatchingStatus(status: String): List<AnimeEntity>

    @Query("SELECT kitsuId FROM anime")
    suspend fun getAllKitsuIds(): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(anime: List<AnimeEntity>)

    @Query("DELETE FROM anime")
    suspend fun clearAll()

    @Query("DELETE FROM anime WHERE kitsuId IN (:kitsuIds)")
    suspend fun deleteByKitsuIds(kitsuIds: List<String>)

    @Query("SELECT animeThemesId FROM anime WHERE kitsuId IN (:kitsuIds) AND animeThemesId IS NOT NULL")
    suspend fun getAnimeThemesIdsByKitsuIds(kitsuIds: List<String>): List<Long>

    @Query("""
        SELECT DISTINCT a.kitsuId FROM anime a
        INNER JOIN themes t ON t.animeId = a.animeThemesId
        INNER JOIN playlist_entries pe ON pe.themeId = t.id
        INNER JOIN playlists p ON p.id = pe.playlistId
        WHERE p.isAuto = 0
    """)
    suspend fun getKitsuIdsInUserPlaylists(): List<String>

    @Query("UPDATE anime SET isManuallyAdded = 1 WHERE kitsuId = :kitsuId")
    suspend fun markManuallyAdded(kitsuId: String)

    @Query("""
        UPDATE anime SET animeThemesId = NULL
        WHERE animeThemesId IS NOT NULL
          AND kitsuId NOT IN (
              SELECT kitsuId FROM (
                  SELECT kitsuId, animeThemesId,
                         ROW_NUMBER() OVER (PARTITION BY animeThemesId ORDER BY syncedAt ASC) AS rn
                  FROM anime
                  WHERE animeThemesId IS NOT NULL
              ) WHERE rn = 1
          )
          AND animeThemesId IN (
              SELECT animeThemesId FROM anime
              WHERE animeThemesId IS NOT NULL
              GROUP BY animeThemesId HAVING COUNT(*) > 1
          )
    """)
    suspend fun clearDuplicateAnimeThemesIds(): Int
}

data class AnimeWithThemeCount(
    @Embedded val anime: AnimeEntity,
    @ColumnInfo(name = "themeCount") val themeCount: Int
)
