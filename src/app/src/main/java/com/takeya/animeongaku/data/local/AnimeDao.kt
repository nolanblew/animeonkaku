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

    @Query("SELECT kitsuId FROM anime")
    suspend fun getAllKitsuIds(): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(anime: List<AnimeEntity>)

    @Query("DELETE FROM anime")
    suspend fun clearAll()
}

data class AnimeWithThemeCount(
    @Embedded val anime: AnimeEntity,
    @ColumnInfo(name = "themeCount") val themeCount: Int
)
