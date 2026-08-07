package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingOpDao {
    @Insert
    suspend fun insert(op: PendingOpEntity): Long

    /** Oldest-first drain order so ops apply in the sequence the user made them. */
    @Query("SELECT * FROM pending_ops ORDER BY createdAt ASC, id ASC LIMIT :limit")
    suspend fun oldest(limit: Int): List<PendingOpEntity>

    @Query("SELECT * FROM pending_ops ORDER BY createdAt ASC, id ASC")
    suspend fun all(): List<PendingOpEntity>

    @Query("SELECT COUNT(*) FROM pending_ops")
    suspend fun count(): Int

    @Query("SELECT COUNT(*) FROM pending_ops WHERE entityType = :entityType")
    fun observeCountForEntity(entityType: String): Flow<Int>

    @Query("SELECT COUNT(*) FROM pending_ops WHERE entityType = :entityType AND attempts > 0")
    fun observeRetriedCountForEntity(entityType: String): Flow<Int>

    @Query("SELECT entityKey FROM pending_ops WHERE entityType = :entityType AND opType = :opType")
    suspend fun entityKeys(entityType: String, opType: String): List<String>

    @Query("DELETE FROM pending_ops WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("UPDATE pending_ops SET attempts = attempts + 1 WHERE id = :id")
    suspend fun incrementAttempts(id: Long)

    /**
     * Collapse superseded ops for the same target before enqueuing a newer one: an offline user
     * who toggles a like several times only needs the latest state synced. Safe for idempotent
     * upsert/delete ops keyed by (entityType, entityKey).
     */
    @Query("DELETE FROM pending_ops WHERE entityType = :entityType AND entityKey = :entityKey AND opType = :opType")
    suspend fun deleteSuperseded(entityType: String, entityKey: String, opType: String)

    /** Rewrite outbox payload keys after an offline-created entity gets its server id. */
    @Query("UPDATE pending_ops SET entityKey = :serverKey WHERE entityType = :entityType AND entityKey = :tempKey")
    suspend fun remapEntityKey(entityType: String, tempKey: String, serverKey: String)
}
