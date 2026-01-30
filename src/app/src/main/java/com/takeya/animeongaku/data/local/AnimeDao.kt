package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface AnimeDao {
    @Query("SELECT * FROM anime ORDER BY title ASC")
    fun observeAll(): Flow<List<AnimeEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(anime: List<AnimeEntity>)

    @Query("DELETE FROM anime")
    suspend fun clearAll()
}
