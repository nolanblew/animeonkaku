package com.takeya.animeongaku.ui.library

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.DownloadDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.download.DownloadManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.network.ConnectivityMonitor
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class PlaylistDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val playlistDao: PlaylistDao,
    private val themeDao: ThemeDao,
    animeDao: AnimeDao,
    val nowPlayingManager: NowPlayingManager,
    val downloadManager: DownloadManager,
    private val downloadDao: DownloadDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    connectivityMonitor: ConnectivityMonitor
) : ViewModel() {
    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline
    private val playlistId: Long = checkNotNull(savedStateHandle["playlistId"]) {
        "playlistId is required"
    }

    val playlist = playlistDao.observePlaylist(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    private val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val animeList: StateFlow<List<AnimeEntity>> = anime

    private val rawTracks = playlistDao.observePlaylistTracks(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val tracks: StateFlow<List<PlaylistTrack>> = combine(rawTracks, playlist, anime) { trackList, pl, animeList ->
        if (pl?.isAuto == true && trackList.isNotEmpty()) {
            val animeMap = animeList.mapNotNull { a -> a.animeThemesId?.let { it to a } }.toMap()
            trackList.sortedWith(compareBy<PlaylistTrack> { track ->
                val a = track.theme.animeId?.let { animeMap[it] }
                a?.title?.lowercase() ?: "\uFFFF"
            }.thenBy { track ->
                val type = track.theme.themeType?.uppercase() ?: ""
                when {
                    type.startsWith("OP") -> 0
                    type.startsWith("ED") -> 1
                    else -> 2
                }
            }.thenBy { track ->
                val type = track.theme.themeType ?: ""
                val num = type.filter { it.isDigit() }
                num.toIntOrNull() ?: 0
            })
        } else {
            trackList
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val coverUrls: StateFlow<List<String>> = playlistDao.observePlaylistCoverUrls(playlistId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val allThemes = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val searchQuery = MutableStateFlow("")

    fun onSearchChange(value: String) {
        searchQuery.value = value
    }

    fun addTheme(theme: ThemeEntity) {
        viewModelScope.launch {
            val exists = tracks.value.any { it.theme.id == theme.id }
            if (exists) return@launch
            val lastOrder = tracks.value.maxOfOrNull { it.orderIndex } ?: -1
            playlistDao.insertEntries(
                listOf(
                    PlaylistEntryEntity(
                        playlistId = playlistId,
                        themeId = theme.id,
                        orderIndex = lastOrder + 1
                    )
                )
            )
        }
    }

    fun removeTheme(themeId: Long) {
        viewModelScope.launch {
            playlistDao.deleteEntry(playlistId, themeId)
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
        viewModelScope.launch {
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
        val list = tracks.value.map { it.theme }
        if (list.isNotEmpty()) nowPlayingManager.play(contextLabel(), list, 0, animeMap = buildAnimeMap())
    }

    fun shuffleAll() {
        val list = tracks.value.map { it.theme }
        if (list.isNotEmpty()) nowPlayingManager.play(contextLabel(), list, 0, shuffle = true, animeMap = buildAnimeMap())
    }

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun addToOtherPlaylist(targetPlaylistId: Long, themeIds: List<Long>) {
        viewModelScope.launch {
            val count = playlistDao.countEntries(targetPlaylistId)
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = targetPlaylistId, themeId = id, orderIndex = count + i)
            }
            playlistDao.insertEntries(entries)
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

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun downloadSong(theme: ThemeEntity) {
        val animeEntry = theme.animeId?.let { id -> anime.value.find { it.animeThemesId == id } }
        downloadManager.downloadSong(theme, animeEntry)
    }

    fun removeDownload(themeId: Long) {
        downloadManager.removeDownload(themeId)
    }

    fun downloadPlaylist() {
        downloadManager.downloadPlaylist(playlistId)
    }

    fun removePlaylistDownload() {
        downloadManager.removePlaylistDownload(playlistId)
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>) {
        viewModelScope.launch {
            val newId = playlistDao.insertPlaylist(
                PlaylistEntity(name = name, createdAt = System.currentTimeMillis())
            )
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = newId, themeId = id, orderIndex = i)
            }
            playlistDao.insertEntries(entries)
        }
    }
}
