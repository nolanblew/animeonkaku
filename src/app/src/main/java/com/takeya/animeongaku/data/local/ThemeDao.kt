package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ThemeDao {
    @Query("SELECT * FROM themes ORDER BY title ASC")
    fun observeAll(): Flow<List<ThemeEntity>>

    @Query("SELECT * FROM themes WHERE id = :themeId LIMIT 1")
    fun observeById(themeId: Long): Flow<ThemeEntity?>

    @Query("SELECT * FROM themes WHERE animeId = :animeId ORDER BY title ASC")
    fun observeByAnimeId(animeId: Long): Flow<List<ThemeEntity>>

    @Query("SELECT * FROM themes WHERE artistName = :artistName ORDER BY title ASC")
    fun observeByArtistName(artistName: String): Flow<List<ThemeEntity>>

    @Query("SELECT * FROM themes ORDER BY title ASC")
    suspend fun getAllThemes(): List<ThemeEntity>

    @Query("SELECT * FROM themes WHERE title LIKE '%' || :query || '%' OR artistName LIKE '%' || :query || '%' ORDER BY title ASC LIMIT 50")
    fun searchThemes(query: String): Flow<List<ThemeEntity>>

    @Query("SELECT EXISTS(SELECT 1 FROM themes WHERE id = :themeId)")
    suspend fun existsById(themeId: Long): Boolean

    @Query("SELECT * FROM themes WHERE id IN (:themeIds)")
    suspend fun getByIds(themeIds: List<Long>): List<ThemeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(themes: List<ThemeEntity>)

    @Query("SELECT id FROM themes WHERE animeId IN (:animeIds)")
    suspend fun getThemeIdsByAnimeIds(animeIds: List<Long>): List<Long>

    @Query("DELETE FROM themes WHERE animeId IN (:animeIds)")
    suspend fun deleteByAnimeIds(animeIds: List<Long>)
}
