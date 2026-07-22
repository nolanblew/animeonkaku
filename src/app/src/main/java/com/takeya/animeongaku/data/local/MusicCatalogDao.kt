package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Embedded
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface MusicCatalogDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSongs(songs: List<SongEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertReleases(releases: List<MusicReleaseEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertReleaseTracks(tracks: List<ReleaseTrackEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAnimeReleases(releases: List<AnimeMusicReleaseEntity>)

    @Query("DELETE FROM anime_music_releases")
    suspend fun deleteAnimeReleases()

    @Query("DELETE FROM release_tracks")
    suspend fun deleteReleaseTracks()

    @Query("DELETE FROM music_releases")
    suspend fun deleteReleases()

    @Query("DELETE FROM songs")
    suspend fun deleteSongs()

    @Query("SELECT * FROM songs WHERE id = :songId LIMIT 1")
    suspend fun getSong(songId: Long): SongEntity?

    @Query("SELECT * FROM songs WHERE id IN (:songIds)")
    suspend fun getSongs(songIds: List<Long>): List<SongEntity>

    @Query("SELECT * FROM music_releases WHERE id = :releaseId LIMIT 1")
    suspend fun getRelease(releaseId: Long): MusicReleaseEntity?

    @Query("SELECT * FROM music_releases WHERE id IN (:releaseIds)")
    suspend fun getReleases(releaseIds: List<Long>): List<MusicReleaseEntity>

    @Query(
        """
        SELECT r.*, amr.relationshipType
        FROM anime_music_releases amr
        JOIN music_releases r ON r.id = amr.releaseId
        WHERE amr.kitsuAnimeId = :kitsuAnimeId
        ORDER BY COALESCE(r.releaseDate, ''), r.id
        """
    )
    fun observeReleasesForAnime(kitsuAnimeId: String): Flow<List<MusicReleaseWithRelationship>>

    @Query(
        """
        SELECT s.*
        FROM release_tracks rt
        JOIN songs s ON s.id = rt.songId
        WHERE rt.releaseId = :releaseId
        ORDER BY rt.displayOrder, rt.discNumber, COALESCE(rt.trackNumber, 2147483647), s.id
        """
    )
    fun observeSongsForRelease(releaseId: Long): Flow<List<SongEntity>>
}
data class MusicReleaseWithRelationship(
    @Embedded val release: MusicReleaseEntity,
    val relationshipType: String
)

@Dao
interface ThemeModeDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(modes: List<ThemeModeEntity>)

    @Query("DELETE FROM theme_modes WHERE themeId IN (:themeIds)")
    suspend fun deleteByThemeIds(themeIds: List<Long>)

    @Query("SELECT * FROM theme_modes WHERE themeId = :themeId LIMIT 1")
    fun observe(themeId: Long): Flow<ThemeModeEntity?>

    @Query("SELECT * FROM theme_modes WHERE themeId IN (:themeIds)")
    fun observeByThemeIds(themeIds: List<Long>): Flow<List<ThemeModeEntity>>

    @Query("SELECT * FROM theme_modes WHERE themeId IN (:themeIds)")
    suspend fun getByThemeIds(themeIds: List<Long>): List<ThemeModeEntity>
}

@Dao
interface SongPreferenceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(preferences: List<SongPreferenceEntity>)

    @Query("SELECT * FROM song_preferences WHERE songId IN (:songIds)")
    suspend fun getByIdsIncludingDeleted(songIds: List<Long>): List<SongPreferenceEntity>

    @Query("SELECT * FROM song_preferences WHERE songId = :songId AND deletedAt IS NULL LIMIT 1")
    fun observe(songId: Long): Flow<SongPreferenceEntity?>
}
