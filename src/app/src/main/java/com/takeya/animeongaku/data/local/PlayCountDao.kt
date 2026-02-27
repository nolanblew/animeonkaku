package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface PlayCountDao {
    @Query("""
        INSERT OR REPLACE INTO play_count (themeId, playCount, lastPlayedAt)
        VALUES (
            :themeId,
            COALESCE((SELECT playCount FROM play_count WHERE themeId = :themeId), 0) + 1,
            :timestamp
        )
    """)
    suspend fun incrementPlayCount(themeId: Long, timestamp: Long = System.currentTimeMillis())

    @Query("""
        SELECT t.* FROM themes t
        INNER JOIN theme_artist ta ON t.id = ta.themeId
        INNER JOIN play_count pc ON t.id = pc.themeId
        WHERE ta.artistName = :artistName
        GROUP BY t.id
        ORDER BY pc.playCount DESC
        LIMIT :limit
    """)
    fun observeTopByArtist(artistName: String, limit: Int = 10): Flow<List<ThemeEntity>>

    @Query("""
        SELECT t.* FROM themes t
        INNER JOIN play_count pc ON t.id = pc.themeId
        ORDER BY pc.playCount DESC
        LIMIT :limit
    """)
    fun observeTopGlobal(limit: Int = 50): Flow<List<ThemeEntity>>

    @Query("SELECT * FROM play_count WHERE themeId = :themeId")
    suspend fun getPlayCount(themeId: Long): PlayCountEntity?

    @Query("SELECT * FROM play_count WHERE themeId IN (:themeIds)")
    fun observePlayCounts(themeIds: List<Long>): Flow<List<PlayCountEntity>>
}
