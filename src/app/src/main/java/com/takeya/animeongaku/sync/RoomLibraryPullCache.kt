package com.takeya.animeongaku.sync

import androidx.room.withTransaction
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeGenreCrossRef
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.ArtistDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeArtistCrossRef
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RoomLibraryPullCache @Inject constructor(
    private val database: AppDatabase,
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val artistDao: ArtistDao,
    private val genreDao: GenreDao,
    private val userPreferenceDao: UserPreferenceDao,
    private val playCountDao: PlayCountDao,
    private val playlistDao: PlaylistDao,
    private val dynamicPlaylistSpecDao: DynamicPlaylistSpecDao
) : LibraryPullCache {
    override suspend fun existingThemes(themeIds: List<Long>): Map<Long, ThemeEntity> {
        if (themeIds.isEmpty()) return emptyMap()
        return themeDao.getByIds(themeIds).associateBy { it.id }
    }

    override suspend fun applyLibraryPull(
        deletedKitsuIds: List<String>,
        deletedThemeIds: List<Long>,
        anime: List<AnimeEntity>,
        themes: List<ThemeEntity>,
        artistRefs: List<ThemeArtistCrossRef>,
        genres: List<GenreEntity>,
        genreRefs: List<AnimeGenreCrossRef>
    ) {
        database.withTransaction {
            if (deletedThemeIds.isNotEmpty()) {
                artistDao.deleteCrossRefsForThemes(deletedThemeIds)
                themeDao.deleteByIds(deletedThemeIds)
            }

            if (deletedKitsuIds.isNotEmpty()) {
                val animeThemeIds = animeDao.getAnimeThemesIdsByKitsuIds(deletedKitsuIds)
                val deletedAnimeThemeIds = animeThemeIds.distinct()
                if (deletedAnimeThemeIds.isNotEmpty()) {
                    val deletedAnimeThemeThemeIds = themeDao.getThemeIdsByAnimeIds(deletedAnimeThemeIds)
                    if (deletedAnimeThemeThemeIds.isNotEmpty()) {
                        artistDao.deleteCrossRefsForThemes(deletedAnimeThemeThemeIds)
                    }
                    themeDao.deleteByAnimeIds(deletedAnimeThemeIds)
                }
                genreDao.deleteForAnimeIds(deletedKitsuIds)
                animeDao.deleteByKitsuIds(deletedKitsuIds)
            }

            if (anime.isNotEmpty()) {
                animeDao.upsertAll(anime)
            }

            if (themes.isNotEmpty()) {
                val themeIds = themes.map { it.id }
                artistDao.deleteCrossRefsForThemes(themeIds)
                themeDao.upsertAll(themes)
                if (artistRefs.isNotEmpty()) {
                    artistDao.upsertCrossRefs(artistRefs)
                }
            }

            val changedAnimeIds = genreRefs.map { it.kitsuId }.distinct()
            if (changedAnimeIds.isNotEmpty()) {
                genreDao.deleteForAnimeIds(changedAnimeIds)
            }
            if (genres.isNotEmpty()) {
                genreDao.upsertGenres(genres)
            }
            if (genreRefs.isNotEmpty()) {
                genreDao.upsertCrossRefs(genreRefs)
            }
        }
    }

    override suspend fun applyThemePrefs(
        preferences: List<UserPreferenceEntity>,
        playCounts: List<PlayCountEntity>
    ) {
        database.withTransaction {
            if (preferences.isNotEmpty()) {
                userPreferenceDao.upsertAll(preferences)
            }
            if (playCounts.isNotEmpty()) {
                playCountDao.upsertAll(playCounts)
            }
        }
    }

    override suspend fun applyAutoPlaylists(
        playlists: List<PlaylistEntity>,
        entries: List<PlaylistEntryEntity>,
        dynamicSpecs: List<DynamicPlaylistSpecEntity>
    ) {
        database.withTransaction {
            val serverAutoIds = playlists
                .filter { it.isAuto }
                .map { it.id }
                .toSet()
            playlistDao.getAutoPlaylistIds()
                .filterNot { it in serverAutoIds }
                .forEach { playlistDao.deletePlaylist(it) }

            val dynamicSpecByPlaylistId = dynamicSpecs.associateBy { it.playlistId }
            playlists.forEach { playlist ->
                playlistDao.insertPlaylist(playlist)
                playlistDao.deletePlaylistEntries(playlist.id)
                val dynamicSpec = dynamicSpecByPlaylistId[playlist.id]
                if (dynamicSpec != null) {
                    dynamicPlaylistSpecDao.upsert(dynamicSpec)
                } else {
                    dynamicPlaylistSpecDao.delete(playlist.id)
                }
            }
            if (entries.isNotEmpty()) {
                playlistDao.insertEntries(entries)
            }
        }
    }
}
