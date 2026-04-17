package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface DynamicPlaylistSpecDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(spec: DynamicPlaylistSpecEntity)

    @Query("SELECT * FROM dynamic_playlist_spec WHERE playlistId = :id")
    suspend fun getById(id: Long): DynamicPlaylistSpecEntity?

    @Query("SELECT * FROM dynamic_playlist_spec WHERE playlistId = :id")
    fun observeById(id: Long): Flow<DynamicPlaylistSpecEntity?>

    @Query("SELECT * FROM dynamic_playlist_spec WHERE mode = 'AUTO'")
    suspend fun getAllAuto(): List<DynamicPlaylistSpecEntity>

    @Query("SELECT * FROM dynamic_playlist_spec")
    fun observeAll(): Flow<List<DynamicPlaylistSpecEntity>>

    @Query("DELETE FROM dynamic_playlist_spec WHERE playlistId = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE dynamic_playlist_spec SET lastEvaluatedAt = :ts, lastResultCount = :n WHERE playlistId = :id")
    suspend fun markEvaluated(id: Long, ts: Long, n: Int)
}
