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

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(themes: List<ThemeEntity>)
}
