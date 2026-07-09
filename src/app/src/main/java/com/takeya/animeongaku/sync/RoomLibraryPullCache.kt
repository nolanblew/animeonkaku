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
import com.takeya.animeongaku.data.local.PendingOpDao
import com.takeya.animeongaku.data.local.PendingOpEntity
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
    private val pendingOpDao: PendingOpDao,
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
            val localById = if (preferences.isNotEmpty()) {
                userPreferenceDao
                    .getPreferencesByIdsIncludingDeleted(preferences.map { it.themeId })
                    .associateBy { it.themeId }
            } else {
                emptyMap()
            }
            val plan = planThemePrefApply(preferences, playCounts, localById)
            if (plan.preferences.isNotEmpty()) {
                userPreferenceDao.upsertAll(plan.preferences)
            }
            if (plan.playCounts.isNotEmpty()) {
                playCountDao.upsertAll(plan.playCounts)
            }
        }
    }

    override suspend fun applyAutoPlaylists(
        deletedPlaylistIds: List<Long>,
        deletedPlaylists: List<PlaylistEntity>,
        pruneMissingAutoPlaylists: Boolean,
        playlists: List<PlaylistEntity>,
        entries: List<PlaylistEntryEntity>,
        dynamicSpecs: List<DynamicPlaylistSpecEntity>
    ) {
        database.withTransaction {
            val deletedById = deletedPlaylists.associateBy { it.id }
            val incomingIds = (deletedPlaylistIds + playlists.map { it.id }).distinct()
            val localById = if (incomingIds.isNotEmpty()) {
                playlistDao.getPlaylistsByIdsIncludingDeleted(incomingIds).associateBy { it.id }
            } else {
                emptyMap()
            }

            deletedPlaylistIds.forEach { playlistId ->
                val incoming = deletedById[playlistId]
                val incomingUpdatedAt = incoming?.updatedAt ?: 0L
                val local = localById[playlistId]
                if (local == null || incomingUpdatedAt >= local.updatedAt) {
                    playlistDao.deletePlaylistEntries(playlistId)
                    dynamicPlaylistSpecDao.delete(playlistId)
                    playlistDao.tombstonePlaylist(
                        playlistId = playlistId,
                        updatedAt = incomingUpdatedAt,
                        deletedAt = incomingUpdatedAt
                    )
                }
            }

            if (pruneMissingAutoPlaylists) {
                val serverAutoIds = playlists
                    .filter { it.isAuto }
                    .map { it.id }
                    .toSet()
                val dynamicPlaylistIds = dynamicPlaylistSpecDao.getAll()
                    .map { it.playlistId }
                    .toSet()
                val pendingCreateIds = pendingOpDao.entityKeys(
                    PendingOpEntity.ENTITY_PLAYLIST,
                    PendingOpEntity.OP_CREATE
                ).mapNotNull { it.toLongOrNull() }.toSet()
                val protectedDynamicIds = dynamicPlaylistIds.filterTo(mutableSetOf()) { playlistId ->
                    OfflineSync.isTempId(playlistId) || playlistId in pendingCreateIds
                }
                autoPlaylistIdsToPrune(
                    localAutoIds = playlistDao.getAutoPlaylistIds(),
                    serverAutoIds = serverAutoIds,
                    protectedDynamicIds = protectedDynamicIds
                )
                    .forEach { playlistDao.deletePlaylist(it) }
            }

            val dynamicSpecByPlaylistId = dynamicSpecs.associateBy { it.playlistId }
            val appliedPlaylistIds = playlists.mapNotNull { playlist ->
                val local = localById[playlist.id]
                if (!shouldApplyIncomingPlaylist(playlist, local)) {
                    return@mapNotNull null
                }
                playlistDao.insertPlaylist(playlist)
                playlistDao.deletePlaylistEntries(playlist.id)
                val dynamicSpec = dynamicSpecByPlaylistId[playlist.id]
                if (dynamicSpec != null) {
                    dynamicPlaylistSpecDao.upsert(dynamicSpec)
                } else {
                    dynamicPlaylistSpecDao.delete(playlist.id)
                }
                playlist.id
            }
            val appliedEntries = entries.filter { it.playlistId in appliedPlaylistIds }
            if (appliedEntries.isNotEmpty()) {
                playlistDao.insertEntries(appliedEntries)
            }
        }
    }
}

internal fun shouldApplyIncomingPlaylist(
    incoming: PlaylistEntity,
    local: PlaylistEntity?
): Boolean =
    local == null || incoming.updatedAt >= local.updatedAt

internal fun autoPlaylistIdsToPrune(
    localAutoIds: List<Long>,
    serverAutoIds: Set<Long>,
    protectedDynamicIds: Set<Long>
): List<Long> =
    localAutoIds.filterNot { it in serverAutoIds || it in protectedDynamicIds }

internal data class ThemePrefApplyPlan(
    val preferences: List<UserPreferenceEntity>,
    val playCounts: List<PlayCountEntity>
)

internal fun planThemePrefApply(
    preferences: List<UserPreferenceEntity>,
    playCounts: List<PlayCountEntity>,
    localById: Map<Long, UserPreferenceEntity>
): ThemePrefApplyPlan {
    val appliedPreferences = preferences.filter { incoming ->
        val local = localById[incoming.themeId]
        local == null || incoming.updatedAt >= local.updatedAt
    }
    return ThemePrefApplyPlan(
        preferences = appliedPreferences,
        playCounts = playCounts
    )
}
