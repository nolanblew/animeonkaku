package com.takeya.animeongaku.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.repository.MusicCatalogRepository
import com.takeya.animeongaku.data.repository.RelatedTrack
import com.takeya.animeongaku.data.repository.HomeTopPicksQuery
import com.takeya.animeongaku.data.repository.HomeTopPicksRepository
import com.takeya.animeongaku.data.repository.HomeTopPicksSnapshot
import com.takeya.animeongaku.data.repository.ServerPlaylistWriter
import com.takeya.animeongaku.data.repository.PlaylistWriteItem
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import com.takeya.animeongaku.ui.common.BrowseVideoStartRequest
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import com.takeya.animeongaku.data.local.DownloadDao
import kotlinx.coroutines.ExperimentalCoroutinesApi

data class HomeQuickPick(
    val item: PlayableItem,
    val relatedTrack: RelatedTrack? = null,
    val reason: String? = null
) {
    val stableKey: String = "${item.key.kind}:${item.key.id}"
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    animeDao: AnimeDao,
    themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val playlistDao: PlaylistDao,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val serverPlaylistWriter: ServerPlaylistWriter,
    private val userPreferencesRepository: UserPreferencesRepository,
    musicCatalogRepository: MusicCatalogRepository,
    private val homeTopPicksRepository: HomeTopPicksRepository,
    playbackPreferences: PlaybackPreferences,
    connectivityMonitor: ConnectivityMonitor
) : ViewModel() {
    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline
    private val allThemes: StateFlow<List<ThemeEntity>> = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

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

    private val _selectedChip = MutableStateFlow<String?>(null)
    val selectedChip: StateFlow<String?> = _selectedChip.asStateFlow()

    val themeModesById: StateFlow<Map<Long, ThemeModeEntity>> = allThemes
        .flatMapLatest { list ->
            val ids = list.map { it.id }
            if (ids.isEmpty()) flowOf(emptyList()) else themeModeDao.observeByThemeIds(ids)
        }
        .map { modes -> modes.associateBy { it.themeId } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    private val _topPicksResponse = MutableStateFlow<HomeTopPicksSnapshot?>(null)
    val quickPicks: StateFlow<List<HomeQuickPick>> = _topPicksResponse
        .map { snapshot -> snapshot?.items?.take(6)?.map { item -> HomeQuickPick(item.item, item.relatedTrack, item.reason) }.orEmpty() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val topPicks: StateFlow<List<HomeQuickPick>> = quickPicks
    private val _topPicksError = MutableStateFlow<String?>(null)
    val topPicksError: StateFlow<String?> = _topPicksError.asStateFlow()
    private val _topPicksLoading = MutableStateFlow(false)
    val topPicksLoading: StateFlow<Boolean> = _topPicksLoading.asStateFlow()

    private val topPicksQuery: StateFlow<HomeTopPicksQuery> = combine(
        playbackPreferences.showOstsOnHomeFlow,
        _selectedChip
    ) { includeExtras, chip ->
        HomeTopPicksQuery(
            includeExtras = includeExtras,
            filter = when (chip) {
                "OPs" -> "OP"
                "EDs" -> "ED"
                else -> "ALL"
            }
        )
    }.distinctUntilChanged().stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        HomeTopPicksQuery(playbackPreferences.showOstsOnHome, "ALL")
    )

    init {
        viewModelScope.launch {
            topPicksQuery.collectLatest { query ->
                _topPicksResponse.value = null
                refreshTopPicks(query)
            }
        }
        viewModelScope.launch {
            allThemes
                .map { it.isNotEmpty() }
                .distinctUntilChanged()
                .filter { it }
                .collectLatest {
                    if (_topPicksResponse.value?.items.isNullOrEmpty()) {
                        _topPicksLoading.first { isLoading -> !isLoading }
                    }
                    if (_topPicksResponse.value?.items.isNullOrEmpty()) {
                        val query = topPicksQuery.value
                        refreshTopPicks(query)
                    }
                }
        }
    }

    private suspend fun refreshTopPicks(query: HomeTopPicksQuery) {
        _topPicksLoading.value = true
        _topPicksError.value = null
        try {
            val cached = homeTopPicksRepository.cachedPreview(query)
            if (topPicksQuery.value != query) return
            if (cached != null) _topPicksResponse.value = cached

            val refreshed = homeTopPicksRepository.refreshPreview(query)
            if (topPicksQuery.value != query) return
            if (refreshed != null) {
                _topPicksResponse.value = refreshed
            } else if (cached == null) {
                _topPicksError.value = "Top picks could not be loaded. Try again when you're online."
            }
        } finally {
            if (topPicksQuery.value == query) _topPicksLoading.value = false
        }
    }

    fun selectChip(chip: String?) {
        _selectedChip.value = if (_selectedChip.value == chip) null else chip
    }

    fun retryTopPicks() {
        val query = topPicksQuery.value
        viewModelScope.launch { refreshTopPicks(query) }
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    fun playFromQuickPicks(stableKey: String) {
        val picks = quickPicks.value
        val idx = picks.indexOfFirst { it.stableKey == stableKey }.coerceAtLeast(0)
        nowPlayingManager.playItems("Quick Picks", picks.map { it.item }, idx)
    }

    fun playTopPicks(onReady: () -> Unit = {}, onError: () -> Unit = {}) {
        viewModelScope.launch {
            val query = topPicksQuery.value
            _topPicksLoading.value = true
            _topPicksError.value = null
            val snapshot = homeTopPicksRepository.full(query)
            _topPicksLoading.value = false
            if (topPicksQuery.value != query) return@launch
            if (snapshot == null) {
                _topPicksError.value = "Top picks could not be loaded. Try again when you're online."
                onError()
                return@launch
            }
            val expected = minOf(snapshot.response.total, 60)
            if (snapshot.items.size < expected) {
                _topPicksError.value = "Top picks are still loading. Try again in a moment."
                onError()
                return@launch
            }
            _topPicksResponse.value = snapshot
            if (snapshot.items.isNotEmpty()) {
                nowPlayingManager.playItems("Top Picks", snapshot.items.map { it.item })
                onReady()
            }
        }
    }

    fun playNext(item: PlayableItem) = nowPlayingManager.playNextItems(listOf(item))

    fun addToQueue(item: PlayableItem) = nowPlayingManager.addPlayableItems(listOf(item))

    fun replaceQueue(item: PlayableItem) = nowPlayingManager.playItems("Now Playing", listOf(item))

    fun requestPlayVideo(themeId: Long): BrowseVideoStartRequest? {
        val theme = allThemes.value.firstOrNull { it.id == themeId } ?: return null
        return BrowseVideoActionPolicy.request(
            isOnline.value,
            "Now Playing",
            listOf(theme),
            themeModesById.value,
            singleAnimeMap(theme)
        )
    }

    fun startPlayVideo(request: BrowseVideoStartRequest): Boolean {
        val themeId = request.themes.singleOrNull()?.id ?: return false
        val currentTheme = allThemes.value.firstOrNull { it.id == themeId } ?: return false
        return request.startIfStillValid(
            nowPlayingManager,
            isOnline.value,
            listOf(currentTheme),
            themeModesById.value,
            "Now Playing",
            singleAnimeMap(currentTheme)
        )
    }

    private fun singleAnimeMap(theme: ThemeEntity): Map<Long, AnimeEntity> =
        theme.animeId?.let { id -> buildAnimeMap()[id]?.let { mapOf(id to it) } } ?: emptyMap()

    fun addToPlaylist(playlistId: Long, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.addThemeEntries(playlistId, themeIds, modeOverride)
        }
    }

    val downloadedThemeIds: StateFlow<Set<Long>> = themeDao.observeDownloadedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val downloadingThemeIds: StateFlow<Set<Long>> = downloadDao.observeDownloadingThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val likedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeLikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val dislikedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeDislikedThemeIds()
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

    fun addSongToPlaylist(playlistId: Long, songId: Long) {
        viewModelScope.launch {
            serverPlaylistWriter.addItems(playlistId, listOf(PlaylistWriteItem(
                itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
                itemId = songId
            )))
        }
    }

    fun observeSongPreference(songId: Long) = userPreferencesRepository.observeSongPreference(songId)

    fun toggleSongLike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongLike(songId) }
    }

    fun toggleSongDislike(songId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleSongDislike(songId) }
    }

    fun downloadRelated(track: RelatedTrack) = downloadManager.downloadRelatedSong(track.song, track.release)

    fun downloadSong(theme: ThemeEntity) {
        val animeEntry = theme.animeId?.let { id -> buildAnimeMap()[id] }
        downloadManager.downloadSong(theme, animeEntry)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>, modeOverride: String? = null) {
        viewModelScope.launch {
            serverPlaylistWriter.createPlaylistWithThemes(name, themeIds, modeOverride)
        }
    }


    fun createAndAddSongToPlaylist(name: String, songId: Long) {
        viewModelScope.launch {
            serverPlaylistWriter.createPlaylistWithItems(name, listOf(PlaylistWriteItem(
                itemType = PlaylistEntryEntity.ITEM_TYPE_SONG,
                itemId = songId
            )))
        }
    }
}
