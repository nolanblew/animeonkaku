package com.takeya.animeongaku.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity

@HiltViewModel
class HomeViewModel @Inject constructor(
    animeDao: AnimeDao,
    themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    private val allThemes: StateFlow<List<ThemeEntity>> = themeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val anime: StateFlow<List<AnimeEntity>> = animeDao.observeAll()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val playlists: StateFlow<List<PlaylistWithCount>> = playlistDao.observePlaylists()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _playlistCoverUrls = MutableStateFlow<Map<Long, List<String>>>(emptyMap())
    val playlistCoverUrls: StateFlow<Map<Long, List<String>>> = _playlistCoverUrls

    init {
        viewModelScope.launch {
            playlists.collect { playlistList ->
                val coverMap = mutableMapOf<Long, List<String>>()
                for (p in playlistList) {
                    coverMap[p.playlist.id] = playlistDao.getPlaylistCoverUrls(p.playlist.id)
                }
                _playlistCoverUrls.value = coverMap
            }
        }
    }

    private val _selectedChip = MutableStateFlow<String?>(null)
    val selectedChip: StateFlow<String?> = _selectedChip.asStateFlow()

    val themes: StateFlow<List<ThemeEntity>> = combine(allThemes, _selectedChip) { themes, chip ->
        when (chip) {
            "OPs" -> themes.filter { it.title.contains("OP", ignoreCase = true) }
            "EDs" -> themes.filter { it.title.contains("ED", ignoreCase = true) }
            else -> themes
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val quickPicks: StateFlow<List<ThemeEntity>> = themes.map { list ->
        list.shuffled().take(6)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val topSongs: StateFlow<List<ThemeEntity>> = themes.map { list ->
        list.shuffled().take(10)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun selectChip(chip: String?) {
        _selectedChip.value = if (_selectedChip.value == chip) null else chip
    }

    private fun buildAnimeMap(): Map<Long, AnimeEntity> {
        return anime.value.mapNotNull { entry ->
            entry.animeThemesId?.let { id -> id to entry }
        }.toMap()
    }

    fun playFromQuickPicks(themeId: Long) {
        val picks = quickPicks.value
        val idx = picks.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("Quick Picks", picks, idx, animeMap = buildAnimeMap())
    }

    fun playFromTopSongs(themeId: Long) {
        val songs = topSongs.value
        val idx = songs.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("Top Songs", songs, idx, animeMap = buildAnimeMap())
    }

    fun addToPlaylist(playlistId: Long, themeIds: List<Long>) {
        viewModelScope.launch {
            val count = playlistDao.countEntries(playlistId)
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = playlistId, themeId = id, orderIndex = count + i)
            }
            playlistDao.insertEntries(entries)
        }
    }

    fun createAndAddToPlaylist(name: String, themeIds: List<Long>) {
        viewModelScope.launch {
            val playlistId = playlistDao.insertPlaylist(
                PlaylistEntity(name = name, createdAt = System.currentTimeMillis())
            )
            val entries = themeIds.mapIndexed { i, id ->
                PlaylistEntryEntity(playlistId = playlistId, themeId = id, orderIndex = i)
            }
            playlistDao.insertEntries(entries)
        }
    }
}
