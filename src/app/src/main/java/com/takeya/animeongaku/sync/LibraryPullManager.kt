package com.takeya.animeongaku.sync

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
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
    moshi: Moshi
) {
    private val anyAdapter = moshi.adapter(Any::class.java)

    suspend fun pullIfStale(
        minIntervalMs: Long,
        now: Long = System.currentTimeMillis()
    ): LibraryPullResult {
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

    suspend fun pullNow(forceFull: Boolean = false): LibraryPullResult {
        val serverBaseUrl = settings.serverBaseUrl ?: return LibraryPullResult(applied = false)
        sideEffects.flushPendingWrites()

        val since = settings.serverPullCursor.takeIf { !forceFull && it > 0L }
        val library = api.library(since = since)

        val activeAnime = library.anime.filterNot { it.deleted }
        val activeThemes = library.themes.filterNot { it.deleted }
        val existingThemes = cache.existingThemes(activeThemes.map { it.id })
        val genreRows = activeAnime.map { it.toGenreRows() }

        cache.applyLibraryPull(
            deletedKitsuIds = library.anime.filter { it.deleted }.map { it.kitsuId },
            deletedThemeIds = library.themes.filter { it.deleted }.map { it.id },
            anime = activeAnime.map { it.toAnimeEntity(serverBaseUrl) },
            themes = activeThemes.map { theme ->
                theme.toThemeEntity(serverBaseUrl, existingThemes[theme.id])
            },
            artistRefs = activeThemes.flatMap { it.toArtistCrossRefs() },
            genres = genreRows.flatMap { it.first }.distinctBy { it.slug },
            genreRefs = genreRows.flatMap { it.second }.distinct()
        )

        val prefs = api.themePrefs()
        cache.applyThemePrefs(
            preferences = prefs.map {
                UserPreferenceEntity(
                    themeId = it.themeId,
                    isLiked = it.liked,
                    isDisliked = it.disliked
                )
            },
            playCounts = prefs.map {
                PlayCountEntity(
                    themeId = it.themeId,
                    playCount = it.playCount,
                    lastPlayedAt = it.lastPlayedAt ?: 0L
                )
            }
        )

        val autoPlaylists = api.playlists()
        cache.applyAutoPlaylists(
            playlists = autoPlaylists.map { it.toPlaylistEntity() },
            entries = autoPlaylists.flatMap { playlist ->
                playlist.entries.mapIndexed { index, themeId ->
                    PlaylistEntryEntity(
                        playlistId = playlist.id,
                        themeId = themeId,
                        orderIndex = index
                    )
                }
            },
            dynamicSpecs = autoPlaylists.mapNotNull { it.toDynamicSpecEntity(anyAdapter) }
        )

        settings.serverPullCursor = library.serverTime
        sideEffects.refreshDynamicPlaylists()
        return LibraryPullResult(
            applied = true,
            animeCount = activeAnime.size,
            themeCount = activeThemes.size,
            serverTime = library.serverTime
        )
    }
}

private fun OngakuPlaylistDto.toPlaylistEntity(): PlaylistEntity =
    PlaylistEntity(
        id = id,
        name = name,
        createdAt = updatedAt,
        isAuto = isAuto || dynamicSpecJson != null
    )

private fun OngakuPlaylistDto.toDynamicSpecEntity(anyAdapter: JsonAdapter<Any>): DynamicPlaylistSpecEntity? {
    val spec = dynamicSpecJson as? Map<*, *> ?: return null
    val filterJson = spec.jsonField("filterJson", anyAdapter) ?: return null
    return DynamicPlaylistSpecEntity(
        playlistId = id,
        filterJson = filterJson,
        mode = spec.stringField("mode") ?: "AUTO",
        createdMode = spec.stringField("createdMode") ?: "ADVANCED",
        schemaVersion = spec.numberField("schemaVersion") ?: 1,
        sortJson = spec.jsonField("sortJson", anyAdapter),
        simpleStateJson = spec.jsonField("simpleStateJson", anyAdapter)
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
    return when (value) {
        is String -> value
        else -> anyAdapter.toJson(value)
    }
}
