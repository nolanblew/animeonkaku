package com.takeya.animeongaku.sync

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton

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

    suspend fun pullIfStale(
        minIntervalMs: Long,
        now: Long = System.currentTimeMillis()
    ): LibraryPullResult {
        if (!sessionStateManager.isOnlineEnabled()) return LibraryPullResult(applied = false)
        if (!settings.isConfigured) return LibraryPullResult(applied = false)
        if (now - settings.serverLastPullAt < minIntervalMs) {
            return LibraryPullResult(applied = false)
        }

        val result = pullNow(forceFull = false)
        if (result.applied) {
            settings.serverLastPullAt = now
        }
        return result
    }

    override suspend fun pullNow(forceFull: Boolean): LibraryPullResult {
        if (!sessionStateManager.isOnlineEnabled()) return LibraryPullResult(applied = false)
        val serverBaseUrl = settings.serverBaseUrl ?: return LibraryPullResult(applied = false)
        sideEffects.flushPendingWrites()

        val since = settings.serverPullCursor.takeIf { !forceFull && it > 0L }
        val changes = api.changes(since = since)

        val activeAnime = changes.anime.filterNot { it.deleted }
        val activeThemes = changes.themes.filterNot { it.deleted }
        val existingThemes = cache.existingThemes(activeThemes.map { it.id })
        val genreRows = activeAnime.map { it.toGenreRows() }

        cache.applyLibraryPull(
            deletedKitsuIds = changes.anime.filter { it.deleted }.map { it.kitsuId },
            deletedThemeIds = changes.themes.filter { it.deleted }.map { it.id },
            anime = activeAnime.map { it.toAnimeEntity(serverBaseUrl) },
            themes = activeThemes.map { theme ->
                theme.toThemeEntity(serverBaseUrl, existingThemes[theme.id])
            },
            artistRefs = activeThemes.flatMap { it.toArtistCrossRefs() },
            genres = genreRows.flatMap { it.first }.distinctBy { it.slug },
            genreRefs = genreRows.flatMap { it.second }.distinct()
        )

        cache.applyThemePrefs(
            preferences = changes.prefs.map {
                UserPreferenceEntity(
                    themeId = it.themeId,
                    isLiked = it.liked,
                    isDisliked = it.disliked,
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
            }
        )

        val playlists = changes.playlists
        val activePlaylists = playlists.filterNot { it.deleted }
        cache.applyAutoPlaylists(
            deletedPlaylistIds = playlists.filter { it.deleted }.map { it.id },
            deletedPlaylists = playlists.filter { it.deleted }.map { it.toPlaylistEntity() },
            pruneMissingAutoPlaylists = since == null,
            playlists = activePlaylists.map { it.toPlaylistEntity() },
            entries = activePlaylists.flatMap { playlist ->
                playlist.entries.mapIndexed { index, themeId ->
                    PlaylistEntryEntity(
                        playlistId = playlist.id,
                        themeId = themeId,
                        orderIndex = index
                    )
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
}

private fun OngakuPlaylistDto.toPlaylistEntity(): PlaylistEntity =
    PlaylistEntity(
        id = id,
        name = name,
        createdAt = updatedAt,
        isAuto = isAuto || dynamicSpecJson != null,
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
