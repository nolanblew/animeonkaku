package com.takeya.animeongaku.ui.player

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistWithCount
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.media.MediaControllerManager
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.NowPlayingState
import com.takeya.animeongaku.media.PlaybackState
import com.takeya.animeongaku.network.ConnectivityMonitor
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class PlayerViewModel @Inject constructor(
    val nowPlayingManager: NowPlayingManager,
    val mediaControllerManager: MediaControllerManager,
    private val playlistDao: PlaylistDao,
    private val themeDao: ThemeDao,
    private val animeDao: AnimeDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    val connectivityMonitor: ConnectivityMonitor
) : ViewModel() {
    val nowPlayingState: StateFlow<NowPlayingState> = nowPlayingManager.state
    val playbackState: StateFlow<PlaybackState> = mediaControllerManager.playbackState

    val isOnline: StateFlow<Boolean> = connectivityMonitor.isOnline

    val downloadedThemeIds: StateFlow<Set<Long>> = themeDao.observeDownloadedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

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

    val dislikedThemeIds: StateFlow<Set<Long>> = userPreferencesRepository.observeDislikedThemeIds()
        .map { it.toSet() }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    val currentPreference = nowPlayingState.flatMapLatest { state ->
        val themeId = state.currentTheme?.id
        if (themeId != null) userPreferencesRepository.observePreference(themeId) else kotlinx.coroutines.flow.flowOf(null)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    suspend fun isInLibrary(themeId: Long): Boolean = themeDao.existsById(themeId)

    fun toggleLike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleLike(themeId) }
    }

    fun toggleDislike(themeId: Long) {
        viewModelScope.launch { userPreferencesRepository.toggleDislike(themeId) }
    }

    fun saveSongToLibrary(theme: ThemeEntity, animeEntity: AnimeEntity?) {
        viewModelScope.launch {
            themeDao.upsertAll(listOf(theme))
            if (animeEntity != null) {
                animeDao.upsertAll(listOf(animeEntity))
            }
        }
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
