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

    @Query("SELECT * FROM songs WHERE id IN (:songIds)")
    fun observeSongs(songIds: List<Long>): Flow<List<SongEntity>>

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
        ORDER BY rt.discNumber, COALESCE(rt.trackNumber, 2147483647), rt.displayOrder, s.id
        """
    )
    fun observeSongsForRelease(releaseId: Long): Flow<List<SongEntity>>

    @Query("SELECT * FROM music_releases WHERE id = :releaseId LIMIT 1")
    fun observeRelease(releaseId: Long): Flow<MusicReleaseEntity?>

    @Query(
        """
        SELECT s.*, rt.discNumber, rt.trackNumber, rt.displayOrder
        FROM release_tracks rt
        JOIN songs s ON s.id = rt.songId
        WHERE rt.releaseId = :releaseId
        ORDER BY rt.discNumber, COALESCE(rt.trackNumber, 2147483647), rt.displayOrder, s.id
        """
    )
    fun observeReleaseTrackRows(releaseId: Long): Flow<List<MusicTrackRow>>

    @Query(
        """
        SELECT r.*, amr.relationshipType, a.kitsuId AS ownerKitsuId,
               COALESCE(a.titleEn, a.title, a.titleRomaji, a.titleJa) AS ownerTitle,
               COALESCE(a.thumbnailUrlLarge, a.thumbnailUrl, a.coverUrlLarge, a.coverUrl) AS ownerArtworkUrl
        FROM music_releases r
        JOIN anime_music_releases amr ON amr.releaseId = r.id
        JOIN anime a ON a.kitsuId = amr.kitsuAnimeId
        WHERE r.title LIKE '%' || :query || '%' COLLATE NOCASE
           OR r.artistCredit LIKE '%' || :query || '%' COLLATE NOCASE
        ORDER BY r.title, a.title
        LIMIT 30
        """
    )
    fun searchReleases(query: String): Flow<List<MusicReleaseSearchRow>>

    @Query(
        """
        SELECT s.*, rt.releaseId, r.title AS releaseTitle, r.artistCredit AS releaseArtistCredit,
               r.releaseDate AS releaseDate, r.year AS releaseYear, r.artworkUrl AS releaseArtworkUrl,
               rt.discNumber, rt.trackNumber, rt.displayOrder, amr.relationshipType,
               a.kitsuId AS ownerKitsuId,
               COALESCE(a.titleEn, a.title, a.titleRomaji, a.titleJa) AS ownerTitle,
               COALESCE(a.thumbnailUrlLarge, a.thumbnailUrl, a.coverUrlLarge, a.coverUrl) AS ownerArtworkUrl
        FROM songs s
        JOIN release_tracks rt ON rt.songId = s.id
        JOIN music_releases r ON r.id = rt.releaseId
        JOIN anime_music_releases amr ON amr.releaseId = r.id
        JOIN anime a ON a.kitsuId = amr.kitsuAnimeId
        WHERE s.title LIKE '%' || :query || '%' COLLATE NOCASE
           OR s.artistCredit LIKE '%' || :query || '%' COLLATE NOCASE
        ORDER BY s.title, r.title, a.title
        LIMIT 50
        """
    )
    fun searchTracks(query: String): Flow<List<MusicTrackSearchRow>>

    @Query(
        """
        SELECT s.*, rt.releaseId, r.title AS releaseTitle, r.artistCredit AS releaseArtistCredit,
               r.releaseDate AS releaseDate, r.year AS releaseYear, r.artworkUrl AS releaseArtworkUrl,
               rt.discNumber, rt.trackNumber, rt.displayOrder, amr.relationshipType,
               a.kitsuId AS ownerKitsuId,
               COALESCE(a.titleEn, a.title, a.titleRomaji, a.titleJa) AS ownerTitle,
               COALESCE(a.thumbnailUrlLarge, a.thumbnailUrl, a.coverUrlLarge, a.coverUrl) AS ownerArtworkUrl
        FROM songs s
        JOIN release_tracks rt ON rt.songId = s.id
        JOIN music_releases r ON r.id = rt.releaseId
        JOIN anime_music_releases amr ON amr.releaseId = r.id
        JOIN anime a ON a.kitsuId = amr.kitsuAnimeId
        WHERE TRIM(s.audioUrl) <> ''
          AND (a.libraryUpdatedAt IS NOT NULL OR a.isManuallyAdded = 1)
        ORDER BY s.id, rt.displayOrder, r.id, a.kitsuId
        """
    )
    fun observeHomeTracks(): Flow<List<MusicTrackSearchRow>>

    @Query("""
        SELECT s.*, rt.releaseId, r.title AS releaseTitle, r.artistCredit AS releaseArtistCredit,
               r.releaseDate AS releaseDate, r.year AS releaseYear, r.artworkUrl AS releaseArtworkUrl,
               rt.discNumber, rt.trackNumber, rt.displayOrder, amr.relationshipType,
               a.kitsuId AS ownerKitsuId, COALESCE(a.titleEn, a.title, a.titleRomaji, a.titleJa) AS ownerTitle,
               COALESCE(a.thumbnailUrlLarge, a.thumbnailUrl, a.coverUrlLarge, a.coverUrl) AS ownerArtworkUrl
        FROM songs s JOIN release_tracks rt ON rt.songId = s.id JOIN music_releases r ON r.id = rt.releaseId
        JOIN anime_music_releases amr ON amr.releaseId = r.id JOIN anime a ON a.kitsuId = amr.kitsuAnimeId
        WHERE TRIM(s.audioUrl) <> '' ORDER BY s.id, rt.displayOrder, r.id, a.kitsuId
    """)
    fun observeAllCatalogTracks(): Flow<List<MusicTrackSearchRow>>

    @Query("""
        SELECT artistName, COUNT(DISTINCT songId) AS trackCount FROM (
          SELECT s.artistCredit AS artistName, s.id AS songId FROM songs s JOIN release_tracks rt ON rt.songId = s.id
          UNION
          SELECT r.artistCredit AS artistName, rt.songId AS songId FROM music_releases r JOIN release_tracks rt ON rt.releaseId = r.id
        ) WHERE TRIM(artistName) <> '' GROUP BY artistName ORDER BY trackCount DESC, artistName
    """)
    fun observeCatalogArtistTrackCounts(): Flow<List<ArtistTrackCount>>
}
data class MusicReleaseWithRelationship(
    @Embedded val release: MusicReleaseEntity,
    val relationshipType: String
)

data class MusicTrackRow(
    @Embedded val song: SongEntity,
    val discNumber: Int,
    val trackNumber: Int?,
    val displayOrder: Int
)

data class MusicReleaseSearchRow(
    @Embedded val release: MusicReleaseEntity,
    val relationshipType: String,
    val ownerKitsuId: String,
    val ownerTitle: String?,
    val ownerArtworkUrl: String?
)

data class MusicTrackSearchRow(
    @Embedded val song: SongEntity,
    val releaseId: Long,
    val releaseTitle: String,
    val releaseArtistCredit: String,
    val releaseDate: String?,
    val releaseYear: Int?,
    val releaseArtworkUrl: String?,
    val discNumber: Int,
    val trackNumber: Int?,
    val displayOrder: Int,
    val relationshipType: String,
    val ownerKitsuId: String,
    val ownerTitle: String?,
    val ownerArtworkUrl: String?
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

    @Query("SELECT * FROM theme_modes WHERE fullSizeSongId = :songId ORDER BY themeId LIMIT 1")
    suspend fun getByFullSizeSongId(songId: Long): ThemeModeEntity?
}

@Dao
interface SongPreferenceDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(preferences: List<SongPreferenceEntity>)

    @Query("SELECT * FROM song_preferences WHERE songId IN (:songIds)")
    suspend fun getByIdsIncludingDeleted(songIds: List<Long>): List<SongPreferenceEntity>

    @Query("SELECT * FROM song_preferences WHERE deletedAt IS NULL")
    suspend fun getAll(): List<SongPreferenceEntity>

    @Query("DELETE FROM song_preferences WHERE songId IN (:songIds)")
    suspend fun deleteBySongIds(songIds: List<Long>)

    @Query("SELECT * FROM song_preferences WHERE songId = :songId AND deletedAt IS NULL LIMIT 1")
    fun observe(songId: Long): Flow<SongPreferenceEntity?>

    @Query("SELECT * FROM song_preferences WHERE deletedAt IS NULL")
    fun observeAll(): Flow<List<SongPreferenceEntity>>

    @Query("SELECT * FROM song_preferences WHERE songId = :songId AND deletedAt IS NULL LIMIT 1")
    suspend fun get(songId: Long): SongPreferenceEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(preference: SongPreferenceEntity)
}
