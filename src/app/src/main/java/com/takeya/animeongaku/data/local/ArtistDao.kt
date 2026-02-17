package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ArtistDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCrossRefs(refs: List<ThemeArtistCrossRef>)

    @Query("DELETE FROM theme_artist WHERE themeId IN (:themeIds)")
    suspend fun deleteCrossRefsForThemes(themeIds: List<Long>)

    @Query("""
        SELECT DISTINCT artistName FROM theme_artist
        ORDER BY artistName ASC
    """)
    fun observeAllArtistNames(): Flow<List<String>>

    @Query("""
        SELECT t.* FROM themes t
        INNER JOIN theme_artist ta ON t.id = ta.themeId
        WHERE ta.artistName = :artistName
        ORDER BY t.title ASC
    """)
    fun observeThemesByArtist(artistName: String): Flow<List<ThemeEntity>>

    @Query("""
        SELECT ta.* FROM theme_artist ta
        WHERE ta.themeId = :themeId
    """)
    fun observeCrossRefsForTheme(themeId: Long): Flow<List<ThemeArtistCrossRef>>

    @Query("""
        SELECT ta.* FROM theme_artist ta
        WHERE ta.themeId IN (:themeIds)
    """)
    suspend fun getCrossRefsForThemes(themeIds: List<Long>): List<ThemeArtistCrossRef>

    @Query("""
        SELECT ta.* FROM theme_artist ta
        WHERE ta.themeId IN (:themeIds)
    """)
    fun observeCrossRefsForThemes(themeIds: List<Long>): Flow<List<ThemeArtistCrossRef>>

    @Query("SELECT COUNT(*) FROM theme_artist WHERE artistName = :artistName")
    fun observeTrackCount(artistName: String): Flow<Int>

    @Query("""
        SELECT artistName, COUNT(DISTINCT themeId) as trackCount
        FROM theme_artist
        GROUP BY artistName
        ORDER BY trackCount DESC
    """)
    fun observeArtistTrackCounts(): Flow<List<ArtistTrackCount>>
}

data class ArtistTrackCount(
    val artistName: String,
    val trackCount: Int
)
