package com.takeya.animeongaku.media

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

@Singleton
@androidx.annotation.OptIn(UnstableApi::class)
class AndroidAutoMediaLibrary @Inject constructor(
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val playlistDao: PlaylistDao,
    private val playCountDao: PlayCountDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    private val nowPlayingManager: NowPlayingManager
) {
    suspend fun getRoot(params: LibraryParams?): LibraryResult<MediaItem> =
        LibraryResult.ofItem(rootItem(), params)

    suspend fun getItem(mediaId: String, params: LibraryParams?): LibraryResult<MediaItem> {
        val item = when (val parsed = AndroidAutoMediaId.parse(mediaId)) {
            AndroidAutoMediaId.Root -> rootItem()
            AndroidAutoMediaId.NowPlaying -> nowPlayingItem()
            AndroidAutoMediaId.Home -> homeItem()
            AndroidAutoMediaId.HomeQuickPicks -> quickPicksItem()
            AndroidAutoMediaId.HomeTopSongs -> topSongsItem()
            AndroidAutoMediaId.AllSongs -> allSongsItem()
            AndroidAutoMediaId.Playlists -> playlistsItem()
            is AndroidAutoMediaId.Playlist -> playlistItem(parsed.playlistId)
            AndroidAutoMediaId.Queue -> queueItem()
            is AndroidAutoMediaId.QueueEntry -> queueEntryItem(parsed.queueId)
            is AndroidAutoMediaId.Track -> trackItem(parsed)
            null -> null
        }
        return item?.let { LibraryResult.ofItem(it, params) }
            ?: LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE, params)
    }

    suspend fun getChildren(
        parentId: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?
    ): LibraryResult<ImmutableList<MediaItem>> {
        val children = when (val parsed = AndroidAutoMediaId.parse(parentId)) {
            AndroidAutoMediaId.Root -> rootChildren()
            AndroidAutoMediaId.NowPlaying -> nowPlayingChildren()
            AndroidAutoMediaId.Home -> homeChildren()
            AndroidAutoMediaId.HomeQuickPicks -> quickPicks()
                .toBrowseTracks { AndroidAutoMediaId.homeQuickTrack(it.id) }
            AndroidAutoMediaId.HomeTopSongs -> topSongs()
                .toBrowseTracks { AndroidAutoMediaId.homeTopTrack(it.id) }
            AndroidAutoMediaId.AllSongs -> allSongs()
                .toBrowseTracks { AndroidAutoMediaId.allSongsTrack(it.id) }
            AndroidAutoMediaId.Playlists -> playlistsChildren()
            is AndroidAutoMediaId.Playlist -> playlistTracks(parsed.playlistId)
                .toBrowseTracks { AndroidAutoMediaId.playlistTrack(parsed.playlistId, it.id) }
            AndroidAutoMediaId.Queue -> queueChildren()
            is AndroidAutoMediaId.QueueEntry,
            is AndroidAutoMediaId.Track,
            null -> null
        }
        return children?.let { LibraryResult.ofItemList(it.page(page, pageSize), params) }
            ?: LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE, params)
    }

    suspend fun getSearchResults(
        query: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?
    ): LibraryResult<ImmutableList<MediaItem>> {
        val normalized = query.trim()
        if (normalized.isBlank()) {
            return LibraryResult.ofItemList(emptyList(), params)
        }

        val playlistResults = playlistDao.searchPlaylists(normalized)
            .first()
            .take(10)
            .map { playlist ->
                playlist.toBrowseItem(
                    mediaId = AndroidAutoMediaId.playlist(playlist.playlist.id),
                    isPlayable = playlist.trackCount > 0
                )
            }
        val songResults = themeDao.searchThemes(normalized)
            .first()
            .take(40)
            .toBrowseTracks { AndroidAutoMediaId.searchTrack(it.id) }

        return LibraryResult.ofItemList((playlistResults + songResults).page(page, pageSize), params)
    }

    suspend fun preparePlayback(
        requestedIds: List<String>,
        startIndex: Int,
        startPositionMs: Long
    ): MediaSession.MediaItemsWithStartPosition? {
        val requestedId = requestedIds.getOrNull(startIndex.coerceAtLeast(0))
            ?: requestedIds.firstOrNull()
            ?: return null

        return when (val parsed = AndroidAutoMediaId.parse(requestedId)) {
            AndroidAutoMediaId.HomeQuickPicks -> playList("Quick Picks", quickPicks(), 0, startPositionMs)
            AndroidAutoMediaId.HomeTopSongs -> playList("Top Songs", topSongs(), 0, startPositionMs)
            AndroidAutoMediaId.AllSongs -> playList("All Songs", allSongs(), 0, startPositionMs)
            is AndroidAutoMediaId.Playlist -> {
                val playlist = playlistDao.getPlaylistById(parsed.playlistId)
                playList(playlist?.name ?: "Playlist", playlistTracks(parsed.playlistId), 0, startPositionMs)
            }
            AndroidAutoMediaId.NowPlaying,
            AndroidAutoMediaId.Queue -> queuePlaybackResult(startPositionMs)
            is AndroidAutoMediaId.QueueEntry -> {
                val state = nowPlayingManager.state.value
                val index = state.indexOfQueueId(parsed.queueId)
                if (index >= 0) {
                    nowPlayingManager.skipTo(index)
                    queuePlaybackResult(0L)
                } else {
                    null
                }
            }
            is AndroidAutoMediaId.Track -> prepareTrackPlayback(parsed, startPositionMs)
            AndroidAutoMediaId.Root,
            AndroidAutoMediaId.Home,
            AndroidAutoMediaId.Playlists,
            null -> null
        }
    }

    suspend fun resolvePlayableItems(mediaItems: List<MediaItem>): List<MediaItem> {
        if (mediaItems.isEmpty()) return emptyList()

        val ids = mediaItems.map { it.mediaId }
        val contextPlayback = preparePlayback(ids, 0, C.TIME_UNSET)
        if (contextPlayback != null) {
            return contextPlayback.mediaItems
        }

        return ids.mapNotNull { id ->
            val track = AndroidAutoMediaId.parse(id) as? AndroidAutoMediaId.Track ?: return@mapNotNull null
            val theme = themeDao.getByIds(listOf(track.themeId)).firstOrNull() ?: return@mapNotNull null
            val animeMap = animeMapFor(listOf(theme))
            theme.toPlaybackMediaItem(id, animeMap)
        }
    }

    private suspend fun rootChildren(): List<MediaItem> =
        listOf(nowPlayingItem(), homeItem(), playlistsItem(), queueItem())

    private fun rootItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.ROOT,
            title = "Anime Ongaku",
            subtitle = "Home, playlists, and queue",
            mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
            folderType = MediaMetadata.FOLDER_TYPE_MIXED
        )

    private fun homeItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.HOME,
            title = "Home",
            subtitle = "Quick picks, top songs, and all songs",
            mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
            folderType = MediaMetadata.FOLDER_TYPE_MIXED
        )

    private fun playlistsItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.PLAYLISTS,
            title = "Playlists",
            subtitle = "Your saved playlists",
            mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_PLAYLISTS,
            folderType = MediaMetadata.FOLDER_TYPE_PLAYLISTS
        )

    private fun queueItem(): MediaItem {
        val state = nowPlayingManager.state.value
        val hasQueue = state.nowPlayingEntries.isNotEmpty()
        return browsableItem(
            mediaId = AndroidAutoMediaId.QUEUE,
            title = "Up Next",
            subtitle = if (hasQueue) "${state.upcomingEntries.size} upcoming" else "Queue is empty",
            isPlayable = hasQueue,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )
    }

    private fun nowPlayingItem(): MediaItem {
        val state = nowPlayingManager.state.value
        val current = state.currentTheme
        return browsableItem(
            mediaId = AndroidAutoMediaId.NOW_PLAYING,
            title = "Now Playing",
            subtitle = current?.let { theme ->
                listOfNotNull(theme.title, theme.artistName).joinToString(" - ")
            } ?: "Nothing playing",
            isPlayable = current != null,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )
    }

    private fun quickPicksItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.HOME_QUICK_PICKS,
            title = "Quick Picks",
            subtitle = "Liked and library songs",
            isPlayable = true,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )

    private fun topSongsItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.HOME_TOP_SONGS,
            title = "Top Songs",
            subtitle = "Most played and liked songs",
            isPlayable = true,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )

    private fun allSongsItem(): MediaItem =
        browsableItem(
            mediaId = AndroidAutoMediaId.ALL_SONGS,
            title = "All Songs",
            subtitle = "Full library",
            isPlayable = true,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )

    private suspend fun playlistItem(playlistId: Long): MediaItem? {
        val playlist = playlistDao.observePlaylists().first()
            .firstOrNull { it.playlist.id == playlistId }
            ?: return null
        return playlist.toBrowseItem(
            mediaId = AndroidAutoMediaId.playlist(playlistId),
            isPlayable = playlist.trackCount > 0
        )
    }

    private suspend fun trackItem(track: AndroidAutoMediaId.Track): MediaItem? {
        val theme = themeDao.getByIds(listOf(track.themeId)).firstOrNull() ?: return null
        return theme.toBrowseTrack(track.rawId, animeMapFor(listOf(theme)))
    }

    private fun queueEntryItem(queueId: Long): MediaItem? {
        val state = nowPlayingManager.state.value
        val entry = state.nowPlayingEntries.firstOrNull { it.queueId == queueId } ?: return null
        return entry.theme.toBrowseTrack(AndroidAutoMediaId.queueEntry(queueId), state.animeMap)
    }

    private suspend fun homeChildren(): List<MediaItem> =
        listOf(quickPicksItem(), topSongsItem(), allSongsItem())

    private fun nowPlayingChildren(): List<MediaItem> {
        val state = nowPlayingManager.state.value
        val current = state.currentEntry ?: return emptyList()
        return (listOf(current) + state.upcomingEntries.take(25)).map { entry ->
            entry.theme.toBrowseTrack(AndroidAutoMediaId.queueEntry(entry.queueId), state.animeMap)
        }
    }

    private suspend fun playlistsChildren(): List<MediaItem> =
        playlistDao.observePlaylists()
            .first()
            .map {
                it.toBrowseItem(
                    mediaId = AndroidAutoMediaId.playlist(it.playlist.id),
                    isPlayable = it.trackCount > 0
                )
            }

    private fun queueChildren(): List<MediaItem> {
        val state = nowPlayingManager.state.value
        return state.nowPlayingEntries.map { entry ->
            entry.theme.toBrowseTrack(AndroidAutoMediaId.queueEntry(entry.queueId), state.animeMap)
        }
    }

    private suspend fun prepareTrackPlayback(
        track: AndroidAutoMediaId.Track,
        startPositionMs: Long
    ): MediaSession.MediaItemsWithStartPosition? =
        when (track.context) {
            AndroidAutoMediaId.TrackContext.HOME_QUICK ->
                playList("Quick Picks", quickPicks(), track.themeId, startPositionMs, startByThemeId = true)
            AndroidAutoMediaId.TrackContext.HOME_TOP ->
                playList("Top Songs", topSongs(), track.themeId, startPositionMs, startByThemeId = true)
            AndroidAutoMediaId.TrackContext.ALL_SONGS,
            AndroidAutoMediaId.TrackContext.SEARCH ->
                playList("All Songs", allSongs(), track.themeId, startPositionMs, startByThemeId = true)
            is AndroidAutoMediaId.TrackContext.PLAYLIST -> {
                val playlist = playlistDao.getPlaylistById(track.context.playlistId)
                playList(
                    playlist?.name ?: "Playlist",
                    playlistTracks(track.context.playlistId),
                    track.themeId,
                    startPositionMs,
                    startByThemeId = true
                )
            }
        }

    private suspend fun playList(
        label: String,
        themes: List<ThemeEntity>,
        start: Long,
        startPositionMs: Long,
        startByThemeId: Boolean = false
    ): MediaSession.MediaItemsWithStartPosition? {
        if (themes.isEmpty()) return null
        val startIndex = if (startByThemeId) {
            themes.indexOfFirst { it.id == start }.coerceAtLeast(0)
        } else {
            start.toInt().coerceIn(0, themes.lastIndex)
        }
        nowPlayingManager.play(
            contextLabel = label,
            themes = themes,
            startIndex = startIndex,
            animeMap = animeMapFor(themes)
        )
        return queuePlaybackResult(startPositionMs)
    }

    private fun queuePlaybackResult(startPositionMs: Long): MediaSession.MediaItemsWithStartPosition? {
        val state = nowPlayingManager.state.value
        if (state.nowPlayingEntries.isEmpty()) return null
        val items = state.nowPlayingEntries.map { it.toPlaybackMediaItem(state.animeMap) }
        return MediaSession.MediaItemsWithStartPosition(
            items,
            state.currentIndex.coerceIn(0, items.lastIndex),
            startPositionMs
        )
    }

    private suspend fun quickPicks(): List<ThemeEntity> {
        val likedIds = userPreferencesRepository.observeLikedThemeIds().first().toSet()
        return allSongs()
            .sortedWith(
                compareByDescending<ThemeEntity> { it.id in likedIds }
                    .thenBy { it.title.lowercase() }
                    .thenBy { it.id }
            )
            .take(HOME_SECTION_LIMIT)
    }

    private suspend fun topSongs(): List<ThemeEntity> {
        val likedIds = userPreferencesRepository.observeLikedThemeIds().first().toSet()
        val playCounts = playCountDao.getAllPlayCounts().associate { it.themeId to it.playCount }
        return allSongs()
            .sortedWith(
                compareByDescending<ThemeEntity> { playCounts[it.id] ?: 0 }
                    .thenByDescending { it.id in likedIds }
                    .thenBy { it.title.lowercase() }
                    .thenBy { it.id }
            )
            .take(TOP_SONG_LIMIT)
    }

    private suspend fun allSongs(): List<ThemeEntity> =
        themeDao.getAllThemes()

    private suspend fun playlistTracks(playlistId: Long): List<ThemeEntity> =
        playlistDao.observePlaylistTracks(playlistId)
            .first()
            .map { it.theme }

    private suspend fun animeMapFor(themes: List<ThemeEntity>): Map<Long, AnimeEntity> {
        val animeIds = themes.mapNotNull { it.animeId }.distinct()
        if (animeIds.isEmpty()) return emptyMap()
        return animeDao.getByAnimeThemesIds(animeIds)
            .mapNotNull { anime -> anime.animeThemesId?.let { it to anime } }
            .toMap()
    }

    private suspend fun List<ThemeEntity>.toBrowseTracks(
        mediaIdFor: (ThemeEntity) -> String
    ): List<MediaItem> {
        val animeMap = animeMapFor(this)
        return map { theme -> theme.toBrowseTrack(mediaIdFor(theme), animeMap) }
    }

    private fun browsableItem(
        mediaId: String,
        title: String,
        subtitle: String? = null,
        isPlayable: Boolean = false,
        mediaType: Int,
        folderType: Int
    ): MediaItem =
        MediaItem.Builder()
            .setMediaId(mediaId)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setIsBrowsable(true)
                    .setIsPlayable(isPlayable)
                    .setMediaType(mediaType)
                    .setFolderType(folderType)
                    .setExtras(categoryExtras())
                    .build()
            )
            .build()

    private fun ThemeEntity.toBrowseTrack(
        mediaId: String,
        animeMap: Map<Long, AnimeEntity>
    ): MediaItem {
        val anime = animeId?.let { animeMap[it] }
        val subtitle = listOfNotNull(
            artistName?.takeIf { it.isNotBlank() },
            anime?.title?.takeIf { it.isNotBlank() },
            themeType?.takeIf { it.isNotBlank() }
        ).joinToString(" - ")
        return MediaItem.Builder()
            .setMediaId(mediaId)
            .setUri(playbackUri())
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle.ifBlank { null })
                    .setArtist(artistName)
                    .setAlbumTitle(anime?.title)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
                    .apply {
                        val artworkUrl = anime?.primaryArtworkUrl()
                        if (!artworkUrl.isNullOrBlank()) {
                            setArtworkUri(Uri.parse(artworkUrl))
                        }
                    }
                    .build()
            )
            .build()
    }

    private fun PlaylistWithCount.toBrowseItem(mediaId: String, isPlayable: Boolean): MediaItem =
        browsableItem(
            mediaId = mediaId,
            title = playlist.name,
            subtitle = "$trackCount songs",
            isPlayable = isPlayable,
            mediaType = MediaMetadata.MEDIA_TYPE_PLAYLIST,
            folderType = MediaMetadata.FOLDER_TYPE_TITLES
        )

    private fun categoryExtras(): Bundle =
        Bundle().apply {
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_CATEGORY_LIST_ITEM
            )
            putInt(
                MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM
            )
        }

    private fun <T> List<T>.page(page: Int, pageSize: Int): List<T> {
        if (page < 0 || pageSize <= 0) return this
        val fromIndex = page * pageSize
        if (fromIndex >= size) return emptyList()
        return subList(fromIndex, (fromIndex + pageSize).coerceAtMost(size))
    }

    private companion object {
        const val HOME_SECTION_LIMIT = 24
        const val TOP_SONG_LIMIT = 50
    }
}

internal object AndroidAutoMediaId {
    const val ROOT = "ao:root"
    const val NOW_PLAYING = "ao:now"
    const val HOME = "ao:home"
    const val HOME_QUICK_PICKS = "ao:home:quick"
    const val HOME_TOP_SONGS = "ao:home:top"
    const val ALL_SONGS = "ao:songs"
    const val PLAYLISTS = "ao:playlists"
    const val QUEUE = "ao:queue"

    fun playlist(playlistId: Long): String = "ao:playlist:$playlistId"
    fun queueEntry(queueId: Long): String = "ao:queue:$queueId"
    fun homeQuickTrack(themeId: Long): String = "ao:track:home_quick:$themeId"
    fun homeTopTrack(themeId: Long): String = "ao:track:home_top:$themeId"
    fun allSongsTrack(themeId: Long): String = "ao:track:all:$themeId"
    fun searchTrack(themeId: Long): String = "ao:track:search:$themeId"
    fun playlistTrack(playlistId: Long, themeId: Long): String =
        "ao:track:playlist:$playlistId:$themeId"

    fun parse(mediaId: String): Parsed? {
        val parts = mediaId.split(":")
        if (parts.firstOrNull() != "ao") return null
        return when (mediaId) {
            ROOT -> Root
            NOW_PLAYING -> NowPlaying
            HOME -> Home
            HOME_QUICK_PICKS -> HomeQuickPicks
            HOME_TOP_SONGS -> HomeTopSongs
            ALL_SONGS -> AllSongs
            PLAYLISTS -> Playlists
            QUEUE -> Queue
            else -> parseDynamic(mediaId, parts)
        }
    }

    private fun parseDynamic(rawId: String, parts: List<String>): Parsed? =
        when {
            parts.size == 3 && parts[1] == "playlist" ->
                parts[2].toLongOrNull()?.let(::Playlist)
            parts.size == 3 && parts[1] == "queue" ->
                parts[2].toLongOrNull()?.let(::QueueEntry)
            parts.size == 4 && parts[1] == "track" ->
                parseTrack(rawId, parts[2], null, parts[3])
            parts.size == 5 && parts[1] == "track" && parts[2] == "playlist" ->
                parseTrack(rawId, parts[2], parts[3], parts[4])
            else -> null
        }

    private fun parseTrack(
        rawId: String,
        contextPart: String,
        playlistPart: String?,
        themePart: String
    ): Track? {
        val themeId = themePart.toLongOrNull() ?: return null
        val context = when (contextPart) {
            "home_quick" -> TrackContext.HOME_QUICK
            "home_top" -> TrackContext.HOME_TOP
            "all" -> TrackContext.ALL_SONGS
            "search" -> TrackContext.SEARCH
            "playlist" -> {
                val playlistId = playlistPart?.toLongOrNull() ?: return null
                TrackContext.PLAYLIST(playlistId)
            }
            else -> return null
        }
        return Track(rawId, context, themeId)
    }

    sealed interface Parsed

    data object Root : Parsed
    data object NowPlaying : Parsed
    data object Home : Parsed
    data object HomeQuickPicks : Parsed
    data object HomeTopSongs : Parsed
    data object AllSongs : Parsed
    data object Playlists : Parsed
    data object Queue : Parsed

    data class Playlist(val playlistId: Long) : Parsed
    data class QueueEntry(val queueId: Long) : Parsed
    data class Track(
        val rawId: String,
        val context: TrackContext,
        val themeId: Long
    ) : Parsed

    sealed interface TrackContext {
        data object HOME_QUICK : TrackContext
        data object HOME_TOP : TrackContext
        data object ALL_SONGS : TrackContext
        data object SEARCH : TrackContext
        data class PLAYLIST(val playlistId: Long) : TrackContext
    }
}
