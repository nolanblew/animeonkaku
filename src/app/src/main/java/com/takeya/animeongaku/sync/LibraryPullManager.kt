package com.takeya.animeongaku.sync

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

@Singleton
class LibraryPullManager @Inject constructor(
    private val api: OngakuApi,
    private val settings: ServerSettingsStore,
    private val cache: LibraryPullCache,
    private val sideEffects: LibraryPullSideEffects,
    moshi: Moshi,
    private val sessionStateManager: SessionStateManager
) : LibraryPuller {
    private val anyAdapter = moshi.adapter(Any::class.java)
    private val pullMutex = Mutex()

    suspend fun pullIfStale(
        minIntervalMs: Long,
        now: Long = System.currentTimeMillis()
    ): LibraryPullResult = pullMutex.withLock {
        if (!sessionStateManager.isOnlineEnabled()) return@withLock LibraryPullResult(applied = false)
        if (!settings.isConfigured) return@withLock LibraryPullResult(applied = false)
        val projectionNeedsRefresh =
            settings.libraryProjectionVersion < CURRENT_LIBRARY_PROJECTION_VERSION
        if (!projectionNeedsRefresh && now - settings.serverLastPullAt < minIntervalMs) {
            return@withLock LibraryPullResult(applied = false)
        }

        val result = pullNowLocked(forceFull = projectionNeedsRefresh)
        if (result.applied) {
            settings.serverLastPullAt = now
            if (projectionNeedsRefresh) {
                settings.libraryProjectionVersion = CURRENT_LIBRARY_PROJECTION_VERSION
            }
        }
        result
    }

    override suspend fun pullNow(forceFull: Boolean): LibraryPullResult = pullMutex.withLock {
        pullNowLocked(forceFull).also { result ->
            if (forceFull && result.applied) {
                settings.libraryProjectionVersion = CURRENT_LIBRARY_PROJECTION_VERSION
            }
        }
    }

    private suspend fun pullNowLocked(forceFull: Boolean): LibraryPullResult {
        if (!sessionStateManager.isOnlineEnabled()) return LibraryPullResult(applied = false)
        val serverBaseUrl = settings.serverBaseUrl ?: return LibraryPullResult(applied = false)
        sideEffects.flushPendingWrites()

        val since = settings.serverPullCursor.takeIf { !forceFull && it > 0L }
        val changes = api.changes(since = since)

        val activeAnime = changes.anime.filterNot { it.deleted }
        val themeSnapshot = changes.themes
        val activeThemes = themeSnapshot?.filterNot { it.deleted }.orEmpty()
        val existingThemes = if (activeThemes.isEmpty()) emptyMap() else cache.existingThemes(activeThemes.map { it.id })
        val genreRows = activeAnime.map { it.toGenreRows() }

        if (changes.anime.isNotEmpty() || themeSnapshot != null) {
            cache.applyLibraryPull(
                deletedKitsuIds = changes.anime.filter { it.deleted }.map { it.kitsuId },
                deletedThemeIds = themeSnapshot.orEmpty().filter { it.deleted }.map { it.id },
                anime = activeAnime.map { it.toAnimeEntity(serverBaseUrl) },
                themes = activeThemes.map { theme ->
                    theme.toThemeEntity(serverBaseUrl, existingThemes[theme.id])
                },
                themeModes = activeThemes.map { it.toThemeModeEntity(serverBaseUrl) },
                artistRefs = activeThemes.flatMap { it.toArtistCrossRefs() },
                genres = genreRows.flatMap { it.first }.distinctBy { it.slug },
                genreRefs = genreRows.flatMap { it.second }.distinct()
            )
        }

        cache.applyThemePrefs(
            preferences = changes.prefs.map {
                UserPreferenceEntity(
                    themeId = it.themeId,
                    isLiked = it.liked,
                    isDisliked = it.disliked,
                    isDislikedTvSize = it.dislikedTvSize,
                    isDislikedFullSize = it.dislikedFullSize,
                    preferredMode = it.preferredMode,
                    updatedAt = it.updatedAt,
                    deletedAt = it.updatedAt.takeIf { _ -> it.deleted }
                )
            },
            playCounts = changes.prefs.map {
                PlayCountEntity(
                    themeId = it.themeId,
                    playCount = it.playCount,
                    lastPlayedAt = it.lastPlayedAt ?: 0L
                )
            },
            fullSnapshot = since == null
        )

        changes.songPrefs?.let { songPrefs ->
            cache.applySongPrefs(
                songPrefs.map {
                    SongPreferenceEntity(
                        songId = it.songId,
                        isLiked = it.liked,
                        isDisliked = it.disliked,
                        playCount = it.playCount,
                        lastPlayedAt = it.lastPlayedAt,
                        updatedAt = it.updatedAt,
                        deletedAt = it.updatedAt.takeIf { _ -> it.deleted }
                    )
                },
                fullSnapshot = since == null
            )
        }

        changes.musicCatalog?.let { catalog ->
            cache.replaceMusicCatalog(catalog.toMusicCatalogSnapshot(serverBaseUrl))
        }

        val playlists = changes.playlists
        val activePlaylists = playlists.filterNot { it.deleted }
        cache.applyAutoPlaylists(
            deletedPlaylistIds = playlists.filter { it.deleted }.map { it.id },
            deletedPlaylists = playlists.filter { it.deleted }.map { it.toPlaylistEntity() },
            pruneMissingAutoPlaylists = since == null,
            playlists = activePlaylists.map { it.toPlaylistEntity() },
            entries = activePlaylists.flatMap { playlist ->
                if (playlist.items.isNotEmpty()) {
                    playlist.items.mapIndexed { index, item ->
                        PlaylistEntryEntity(
                            playlistId = playlist.id,
                            themeId = item.itemId.takeIf { item.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME },
                            orderIndex = index,
                            entryId = item.entryId,
                            itemType = item.itemType,
                            itemId = item.itemId,
                            modeOverride = item.modeOverride
                        )
                    }
                } else {
                    val occurrences = mutableMapOf<Long, Int>()
                    playlist.entries.mapIndexed { index, themeId ->
                        val occurrence = occurrences.getOrDefault(themeId, 0)
                        occurrences[themeId] = occurrence + 1
                        PlaylistEntryEntity(
                            playlistId = playlist.id,
                            themeId = themeId,
                            orderIndex = index,
                            entryId = legacyPlaylistEntryId(themeId, occurrence)
                        )
                    }
                }
            },
            dynamicSpecs = activePlaylists.mapNotNull { it.toDynamicSpecEntity(anyAdapter) }
        )

        settings.serverPullCursor = changes.serverTime
        sideEffects.refreshDynamicPlaylists()
        return LibraryPullResult(
            applied = true,
            animeCount = activeAnime.size,
            themeCount = activeThemes.size,
            serverTime = changes.serverTime
        )
    }

    companion object {
        const val CURRENT_LIBRARY_PROJECTION_VERSION = 1
    }
}

private fun OngakuPlaylistDto.toPlaylistEntity(): PlaylistEntity =
    PlaylistEntity(
        id = id,
        name = name,
        createdAt = updatedAt,
        isAuto = isAuto || dynamicSpecJson != null,
        defaultMode = defaultMode,
        updatedAt = updatedAt,
        deletedAt = updatedAt.takeIf { deleted }
    )

private fun OngakuPlaylistDto.toDynamicSpecEntity(anyAdapter: JsonAdapter<Any>): DynamicPlaylistSpecEntity? {
    val specValue = dynamicSpecJson ?: return null
    val spec = specValue as? Map<*, *>
    val filterJson = spec?.jsonField("filterJson", anyAdapter) ?: specValue.jsonValue(anyAdapter)
    return DynamicPlaylistSpecEntity(
        playlistId = id,
        filterJson = filterJson,
        mode = if (autoUpdate) "AUTO" else "SNAPSHOT",
        createdMode = spec?.stringField("createdMode") ?: "ADVANCED",
        schemaVersion = spec?.numberField("schemaVersion") ?: 1,
        sortJson = dynamicSortJson?.jsonValue(anyAdapter) ?: spec?.jsonField("sortJson", anyAdapter),
        simpleStateJson = spec?.jsonField("simpleStateJson", anyAdapter),
        serverManaged = autoUpdate
    )
}

private fun Map<*, *>.stringField(key: String): String? =
    this[key] as? String

private fun Map<*, *>.numberField(key: String): Int? =
    when (val value = this[key]) {
        is Number -> value.toInt()
        is String -> value.toIntOrNull()
        else -> null
    }

private fun Map<*, *>.jsonField(key: String, anyAdapter: JsonAdapter<Any>): String? {
    val value = this[key] ?: return null
    return value.jsonValue(anyAdapter)
}

private fun Any.jsonValue(anyAdapter: JsonAdapter<Any>): String {
    return when (this) {
        is String -> this
        else -> anyAdapter.toJson(this)
    }
}
