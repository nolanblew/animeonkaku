package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface GenreDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertGenres(genres: List<GenreEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertCrossRefs(refs: List<AnimeGenreCrossRef>)

    @Query("SELECT * FROM genres ORDER BY displayName ASC")
    fun observeAllGenres(): Flow<List<GenreEntity>>

    @Query("SELECT * FROM genres ORDER BY displayName ASC")
    suspend fun getAllGenres(): List<GenreEntity>

    @Query("""
        SELECT g.* FROM genres g
        INNER JOIN anime_genres ag ON ag.slug = g.slug
        WHERE ag.kitsuId = :kitsuId
    """)
    suspend fun getGenresForAnime(kitsuId: String): List<GenreEntity>

    @Query("""
        SELECT DISTINCT ag.kitsuId FROM anime_genres ag
        WHERE ag.slug IN (:slugs)
        GROUP BY ag.kitsuId
        HAVING COUNT(DISTINCT ag.slug) = :slugCount
    """)
    suspend fun getKitsuIdsMatchingAllGenres(slugs: List<String>, slugCount: Int): List<String>

    @Query("""
        SELECT DISTINCT kitsuId FROM anime_genres
        WHERE slug IN (:slugs)
    """)
    suspend fun getKitsuIdsMatchingAnyGenre(slugs: List<String>): List<String>

    @Query("DELETE FROM anime_genres WHERE kitsuId = :kitsuId")
    suspend fun deleteForAnime(kitsuId: String)

    @Query("SELECT * FROM anime_genres")
    suspend fun getAllCrossRefs(): List<AnimeGenreCrossRef>
}
