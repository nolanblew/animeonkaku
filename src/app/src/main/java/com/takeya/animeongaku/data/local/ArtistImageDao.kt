package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ArtistImageDao {
    @Query("SELECT * FROM artist_images WHERE name IN (:names)")
    fun observeByNames(names: List<String>): Flow<List<ArtistImageEntity>>

    @Query("SELECT * FROM artist_images WHERE name IN (:names)")
    suspend fun getByNames(names: List<String>): List<ArtistImageEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(images: List<ArtistImageEntity>)
}
