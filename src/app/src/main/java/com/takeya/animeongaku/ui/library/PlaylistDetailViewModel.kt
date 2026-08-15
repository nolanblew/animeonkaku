package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.filter.applyDynamicDeviceOverlay
import com.takeya.animeongaku.data.filter.buildDynamicOverlayContext
import com.takeya.animeongaku.data.filter.shouldApplyDynamicDeviceOverlay
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.PendingOpDao
import com.takeya.animeongaku.data.local.PendingOpEntity
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.repository.DynamicPlaylistRepository
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.PlaylistWriteItem
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.ThemeModePolicy
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import com.takeya.animeongaku.sync.PendingWriteStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PlaylistItemRow(
    val entry: PlaylistEntryEntity,
    val theme: ThemeEntity? = null,
    val song: SongEntity? = null
) {
    val title: String get() = theme?.title ?: song?.title.orEmpty()
    val artist: String get() = theme?.artistName ?: song?.artistCredit.orEmpty()

    fun playable(animeMap: Map<Long, AnimeEntity>, modes: Map<Long, ThemeModeEntity>): PlayableItem =
        theme?.let { PlayableItem.Theme(it, it.animeId?.let(animeMap::get), modes[it.id]) }
            ?: PlayableItem.RelatedSong(checkNotNull(song))
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class PlaylistDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val playlistDao: PlaylistDao,
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val musicCatalogDao: MusicCatalogDao,
    animeDao: AnimeDao,
    genreDao: GenreDao,
    playCountDao: PlayCountDao,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    connectivityMonitor: ConnectivityMonitor,
    private val dynamicPlaylistRepository: DynamicPlaylistRepository,
    private val serverPlaylistWriter: ServerPlaylistWriter,
    private val pendingOpDao: PendingOpDao
) : ViewModel() {
    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline
    private val playlistId: Long = checkNotNull(savedStateHandle["playlistId"]) {
        "playlistId is required"
    }

    val dynamicSpec: StateFlow<DynamicPlaylistSpecEntity?> = dynamicPlaylistRepository.observeSpec(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val _playlistActionMessage = MutableStateFlow<String?>(null)
    val playlistActionMessage: StateFlow<String?> = _playlistActionMessage

    val pendingPlaylistWriteStatus: StateFlow<PendingWriteStatus> = combine(
        pendingOpDao.observeCountForEntity(PendingOpEntity.ENTITY_PLAYLIST),
        pendingOpDao.observeRetriedCountForEntity(PendingOpEntity.ENTITY_PLAYLIST),
        isOnline
    ) { pendingCount, retriedCount, online ->
        PendingWriteStatus(
            pendingCount = pendingCount,
            retriedCount = retriedCount,
            isOnline = online
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PendingWriteStatus())

    val isDynamic: StateFlow<Boolean> = dynamicSpec
        .map { it != null }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val playlist = playlistDao.observePlaylist(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val animeList: StateFlow<List<AnimeEntity>> = anime

    private val rawTracks = playlistDao.observePlaylistTracks(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val rawEntries = playlistDao.observePlaylistEntries(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    private val entryThemes = rawEntries.flatMapLatest { entries ->
        val ids = entries.filter { it.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME }.map { it.itemId }.distinct()
        if (ids.isEmpty()) flowOf(emptyList()) else themeDao.observeByIds(ids)
    }
    private val entrySongs = rawEntries.flatMapLatest { entries ->
        val ids = entries.filter { it.itemType == PlaylistEntryEntity.ITEM_TYPE_SONG }.map { it.itemId }.distinct()
        if (ids.isEmpty()) flowOf(emptyList()) else musicCatalogDao.observeSongs(ids)
    }
    val items: StateFlow<List<PlaylistItemRow>> = combine(rawEntries, entryThemes, entrySongs) { entries, themes, songs ->
        val themesById = themes.associateBy { it.id }
        val songsById = songs.associateBy { it.id }
        entries.mapNotNull { entry ->
            when (entry.itemType) {
                PlaylistEntryEntity.ITEM_TYPE_THEME -> themesById[entry.itemId]?.let { PlaylistItemRow(entry, theme = it) }
                PlaylistEntryEntity.ITEM_TYPE_SONG -> songsById[entry.itemId]?.let { PlaylistItemRow(entry, song = it) }
                else -> null
            }
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val downloadedThemeIds: StateFlow<Set<Long>> = themeDao.observeDownloadedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val likedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeLikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val dislikedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeDislikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    private val genreCrossRefs = genreDao.observeAllCrossRefs()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val playCounts = playCountDao.observeAllPlayCounts()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private data class DynamicOverlayPrefs(
        val downloadedThemeIds: Set<Long>,
        val likedThemeIds: Set<Long>,
        val dislikedThemeIds: Set<Long>
    )

    private data class DynamicOverlayState(
        val spec: DynamicPlaylistSpecEntity?,
        val prefs: DynamicOverlayPrefs,
        val genreCrossRefs: List<com.takeya.animeongaku.data.local.AnimeGenreCrossRef>,
        val playCounts: List<com.takeya.animeongaku.data.local.PlayCountEntity>
    )

    private val dynamicOverlayPrefs: StateFlow<DynamicOverlayPrefs> = combine(
        downloadedThemeIds,
        likedThemeIds,
        dislikedThemeIds
    ) { downloaded, liked, disliked ->
        DynamicOverlayPrefs(downloaded, liked, disliked)
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        DynamicOverlayPrefs(emptySet(), emptySet(), emptySet())
    )

    private val dynamicOverlayState: StateFlow<DynamicOverlayState> = combine(
        dynamicSpec,
        dynamicOverlayPrefs,
        genreCrossRefs,
        playCounts
    ) { spec, prefs, refs, counts ->
        DynamicOverlayState(
            spec = spec,
            prefs = prefs,
            genreCrossRefs = refs,
            playCounts = counts
        )
    }.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        DynamicOverlayState(null, DynamicOverlayPrefs(emptySet(), emptySet(), emptySet()), emptyList(), emptyList())
    )

    val tracks: StateFlow<List<PlaylistTrack>> = combine(
        rawTracks,
        playlist,
        anime,
        dynamicOverlayState
    ) { trackList, pl, animeList, overlay ->
        val spec = overlay.spec
        if (spec != null) {
            val filter = dynamicPlaylistRepository.decodeFilter(spec)
            val sort = dynamicPlaylistRepository.decodeSort(spec)
            if (!shouldApplyDynamicDeviceOverlay(spec, filter, sort)) {
                return@combine trackList
            }
            val context = buildDynamicOverlayContext(
                tracks = trackList,
                anime = animeList,
                genreRefs = overlay.genreCrossRefs,
                likedThemeIds = overlay.prefs.likedThemeIds,
                dislikedThemeIds = overlay.prefs.dislikedThemeIds,
                downloadedThemeIds = overlay.prefs.downloadedThemeIds,
                playCounts = overlay.playCounts
            )
            return@combine applyDynamicDeviceOverlay(trackList, filter, sort, context)
        }
        if (pl?.isAuto == true) {
            preserveMaterializedPlaylistOrder(trackList)
        } else {
            trackList
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val themeModesById: StateFlow<Map<Long, ThemeModeEntity>> = tracks
        .map { list -> list.map { it.theme.id } }
        .flatMapLatest { ids ->
            if (ids.isEmpty()) flowOf(emptyList()) else themeModeDao.observeByThemeIds(ids)
        }
        .map { modes -> modes.associateBy { it.themeId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    val coverUrls: StateFlow<List<List<String>>> = playlistDao.observePlaylistCoverUrls(playlistId)
        .map { slots ->
            slots.map { slot ->
                listOfNotNull(
                    slot.coverUrl?.takeIf { it.isNotBlank() },
                    slot.thumbnailUrl?.takeIf { it.isNotBlank() }
                )
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val allThemes = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val searchQuery = MutableStateFlow("")

    fun onSearchChange(value: String) {
        searchQuery.value = value
    }

    fun addTheme(theme: ThemeEntity) {
        runPlaylistAction("Couldn't add that track. Try again when your connection is stable.") {
            serverPlaylistWriter.addEntries(playlistId, listOf(theme.id))
        }
    }

    fun addTheme(theme: ThemeEntity, modeOverride: String?) {
        runPlaylistAction("Couldn't add that track. Try again when your connection is stable.") {
            serverPlaylistWriter.addItems(playlistId, listOf(PlaylistWriteItem(
                itemType = PlaylistEntryEntity.ITEM_TYPE_THEME,
                itemId = theme.id,
                modeOverride = modeOverride
            )))
        }
    }

    fun removeTheme(themeId: Long) {
        runPlaylistAction("Couldn't remove that track. Try again when your connection is stable.") {
            playlistDao.deleteEntry(playlistId, themeId)
            serverPlaylistWriter.syncPlaylistEntries(playlistId)
        }
    }

    fun moveUp(themeId: Long) {
        val list = tracks.value
        val index = list.indexOfFirst { it.theme.id == themeId }
        if (index <= 0) return
        swapOrder(list[index], list[index - 1])
    }

    fun moveDown(themeId: Long) {
        val list = tracks.value
        val index = list.indexOfFirst { it.theme.id == themeId }
        if (index == -1 || index >= list.lastIndex) return
        swapOrder(list[index], list[index + 1])
    }

    private fun swapOrder(current: PlaylistTrack, neighbor: PlaylistTrack) {
        runPlaylistAction("Couldn't reorder playlist. Try again when your connection is stable.") {
            playlistDao.insertEntries(
                listOf(
                    PlaylistEntryEntity(
                        playlistId = playlistId,
                        themeId = current.theme.id,
                        orderIndex = neighbor.orderIndex
                    ),
                    PlaylistEntryEntity(
                        playlistId = playlistId,
                        themeId = neighbor.theme.id,
                        orderIndex = current.orderIndex
                    )
                )
            )
            serverPlaylistWriter.syncPlaylistEntries(playlistId)
        }
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    private fun contextLabel(): String = playlist.value?.name ?: "Playlist"

    fun playTheme(themeId: Long) {
        val list = tracks.value.map { it.theme }
        val idx = list.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play(contextLabel(), list, idx, animeMap = buildAnimeMap())
    }

    fun playAll() {
        playPlaylistItems(0, shuffle = false)
    }

    fun removeEntry(entryId: Long) {
        runPlaylistAction("Couldn't remove that item. Try again when your connection is stable.") {
            playlistDao.deleteEntryById(playlistId, entryId)
            serverPlaylistWriter.syncPlaylistItems(playlistId)
        }
    }

    fun updateEntryMode(entryId: Long, modeOverride: String?) {
        runPlaylistAction("Couldn't update playback version. Try again when your connection is stable.") {
            serverPlaylistWriter.updateItemMode(playlistId, entryId, modeOverride)
        }
    }

    fun updateDefaultMode(defaultMode: String) {
        runPlaylistAction("Couldn't update the playlist default. Try again when your connection is stable.") {
            serverPlaylistWriter.updateDefaultMode(playlistId, defaultMode)
        }
    }

    fun updateOverrideUserPreference(overrideUserPreference: Boolean) {
        runPlaylistAction("Couldn't update the playlist override. Try again when your connection is stable.") {
            serverPlaylistWriter.updateOverrideUserPreference(playlistId, overrideUserPreference)
        }
    }

    fun moveEntry(entryId: Long, direction: Int) {
        val list = items.value
        val index = list.indexOfFirst { it.entry.entryId == entryId }
        val target = index + direction
        if (index !in list.indices || target !in list.indices) return
        runPlaylistAction("Couldn't reorder playlist. Try again when your connection is stable.") {
            val current = list[index].entry
            val neighbor = list[target].entry
            playlistDao.insertEntries(listOf(
                current.copy(orderIndex = neighbor.orderIndex),
                neighbor.copy(orderIndex = current.orderIndex)
            ))
            serverPlaylistWriter.syncPlaylistItems(playlistId)
        }
    }

    fun requestPlayVideoTheme(themeId: Long): BrowseVideoStartRequest? {
        val theme = tracks.value.firstOrNull { it.theme.id == themeId }?.theme ?: return null
        return BrowseVideoActionPolicy.request(isOnline.value, contextLabel(), listOf(theme), themeModesById.value, buildAnimeMap())
    }

    fun requestPlayVideoAll(): BrowseVideoStartRequest? = BrowseVideoActionPolicy.request(
        isOnline.value, contextLabel(), tracks.value.map { it.theme }, themeModesById.value, buildAnimeMap()
    )

    fun startPlayVideo(request: BrowseVideoStartRequest): Boolean {
        val all = tracks.value.map { it.theme }
        val currentThemes = if (request.themes.size == 1) all.filter { it.id == request.themes.single().id } else all
        return request.startIfStillValid(
            nowPlayingManager, isOnline.value, currentThemes, themeModesById.value,
            contextLabel(), buildAnimeMap()
        )
    }

    fun shuffleAll() {
        playPlaylistItems(0, shuffle = true)
    }

    fun playEntry(entryId: Long) {
        val index = items.value.indexOfFirst { it.entry.entryId == entryId }
        if (index >= 0) playPlaylistItems(index, shuffle = false)
    }

    fun playNextEntry(entryId: Long) {
        val row = items.value.firstOrNull { it.entry.entryId == entryId } ?: return
        val animeMap = buildAnimeMap()
        nowPlayingManager.playNextItems(
            listOf(row.playable(animeMap, themeModesById.value)),
            animeMap,
            row.baseModePolicy(playlist.value)
        )
    }

    fun addEntryToQueue(entryId: Long) {
        val row = items.value.firstOrNull { it.entry.entryId == entryId } ?: return
        val animeMap = buildAnimeMap()
        nowPlayingManager.addPlayableItems(
            listOf(row.playable(animeMap, themeModesById.value)),
            animeMap,
            row.baseModePolicy(playlist.value)
        )
    }

    fun playNextAll() {
        val rows = items.value
        if (rows.isEmpty()) return
        val animeMap = buildAnimeMap()
        nowPlayingManager.playNextItems(
            items = rows.map { it.playable(animeMap, themeModesById.value) },
            animeMap = animeMap,
            baseModePolicies = rows.map { it.baseModePolicy(playlist.value) }
        )
    }

    fun addAllToQueue() {
        val rows = items.value
        if (rows.isEmpty()) return
        val animeMap = buildAnimeMap()
        nowPlayingManager.addPlayableItems(
            items = rows.map { it.playable(animeMap, themeModesById.value) },
            animeMap = animeMap,
            baseModePolicies = rows.map { it.baseModePolicy(playlist.value) }
        )
    }

    private fun playPlaylistItems(startIndex: Int, shuffle: Boolean) {
        val rows = items.value
        val pl = playlist.value ?: return
        if (rows.isEmpty()) return
        val animeMap = buildAnimeMap()
        val playables = rows.map { it.playable(animeMap, themeModesById.value) }
        val policies = rows.map { it.baseModePolicy(pl) }
        nowPlayingManager.playItems(
            contextLabel = contextLabel(), items = playables, startIndex = startIndex,
            shuffle = shuffle, animeMap = animeMap, baseModePolicies = policies
        )
    }

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlistCoverUrls: StateFlow<Map<Long, List<List<String>>>> = playlistDao.observeAllPlaylistCoverUrls()
        .map { rows ->
            rows.groupBy { it.playlistId }.mapValues { (_, list) ->
                list.take(4).map { row ->
                    listOfNotNull(
                        row.coverUrl?.takeIf { it.isNotBlank() },
                        row.thumbnailUrl?.takeIf { it.isNotBlank() }
                    )
                }
            }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    fun addToOtherPlaylist(targetPlaylistId: Long, themeIds: List<Long>, modeOverride: String? = null) {
        runPlaylistAction("Couldn't save to playlist. Try again when your connection is stable.") {
            serverPlaylistWriter.addThemeEntries(targetPlaylistId, themeIds, modeOverride)
        }
    }

    fun addSongToOtherPlaylist(targetPlaylistId: Long, songId: Long) {
        runPlaylistAction("Couldn't save to playlist. Try again when your connection is stable.") {
            serverPlaylistWriter.addItems(
                targetPlaylistId,
                listOf(PlaylistWriteItem(itemType = "SONG", itemId = songId))
            )
        }
    }

    val downloadingThemeIds: StateFlow<Set<Long>> = downloadDao.observeDownloadingThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    fun observePreference(themeId: Long?) =
        themeId?.let { userPreferencesRepository.observePreference(it) } ?: flowOf(null)

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun setPreferredMode(themeId: Long, mode: String) {
        viewModelScope.launch { userPreferencesRepository.setPreferredMode(themeId, mode) }
    }

    fun downloadSong(theme: ThemeEntity) {
        val animeEntry = theme.animeId?.let { id -> anime.value.find { it.animeThemesId == id } }
        downloadManager.downloadSong(theme, animeEntry)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun downloadPlaylist() {
        downloadManager.downloadPlaylist(playlistId, tracks.value.map { it.theme.id })
    }

    fun removePlaylistDownload() {
        downloadManager.removePlaylistDownload(playlistId)
    }

    fun refreshDynamic() {
        viewModelScope.launch {
            dynamicPlaylistRepository.refreshOne(playlistId)
        }
    }

    fun deletePlaylist() {
        runPlaylistAction("Couldn't delete playlist. Try again when your connection is stable.") {
            if (dynamicSpec.value != null) {
                dynamicPlaylistRepository.deleteDynamic(playlistId)
            } else {
                serverPlaylistWriter.deletePlaylist(playlistId)
            }
        }
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>, modeOverride: String? = null) {
        runPlaylistAction("Couldn't create playlist. Try again when your connection is stable.") {
            serverPlaylistWriter.createPlaylistWithThemes(name, themeIds, modeOverride)
        }
    }

    fun createAndAddSongToPlaylist(name: String, songId: Long) {
        runPlaylistAction("Couldn't create playlist. Try again when your connection is stable.") {
            serverPlaylistWriter.createPlaylistWithItems(
                name,
                listOf(PlaylistWriteItem(itemType = "SONG", itemId = songId))
            )
        }
    }

    fun clearPlaylistActionMessage() {
        _playlistActionMessage.value = null
    }

    private fun runPlaylistAction(
        failureMessage: String,
        block: suspend () -> Unit
    ) {
        _playlistActionMessage.value = null
        viewModelScope.launch {
            try {
                block()
            } catch (_: Exception) {
                _playlistActionMessage.value = failureMessage
            }
        }
    }
}

/** Auto playlist order is materialized by the server and already sorted by PlaylistDao. */
internal fun preserveMaterializedPlaylistOrder(tracks: List<PlaylistTrack>): List<PlaylistTrack> = tracks

private fun PlaylistItemRow.baseModePolicy(playlist: PlaylistEntity?): BaseModePolicy =
    BaseModePolicy(
        entryPolicy = when (entry.modeOverride) {
            "FULL_SIZE" -> ThemeModePolicy.FULL_SIZE
            "TV_SIZE" -> ThemeModePolicy.TV_SIZE
            else -> ThemeModePolicy.INHERIT
        },
        playlistDefault = if (playlist?.defaultMode == "FULL_SIZE") PlaybackMode.FULL_SIZE else PlaybackMode.TV_SIZE,
        overrideUserPreference = playlist?.overrideUserPreference == true
    )
