package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingPlayDao {
    @Insert
    suspend fun insert(play: PendingPlayEntity)

    @Query("SELECT * FROM pending_plays ORDER BY id LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingPlayEntity>

    @Query("DELETE FROM pending_plays WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM pending_plays")
    suspend fun count(): Int
}
