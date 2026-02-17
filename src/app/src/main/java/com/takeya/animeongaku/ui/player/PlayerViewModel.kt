package com.takeya.animeongaku.ui.player

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class PlayerViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    private val animeDao: AnimeDao
) : ViewModel() {
    private val themeId = savedStateHandle.get<Long>("themeId")?.takeIf { it > 0 }
    private val playlistId = savedStateHandle.get<Long>("playlistId")?.takeIf { it > 0 }
    private val queueSource = savedStateHandle.get<String>("queue").orEmpty()

    val queueState: StateFlow<PlayerQueueState> = buildQueueState()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), PlayerQueueState.empty())

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun buildQueueState(): Flow<PlayerQueueState> {
        val themeFlow: Flow<List<ThemeEntity>> = when {
            playlistId != null -> playlistDao.observePlaylistTracks(playlistId)
                .map { tracks -> tracks.map { it.theme } }
            themeId != null && queueSource == "library" -> themeDao.observeAll()
            themeId != null -> themeDao.observeById(themeId)
                .map { theme -> listOfNotNull(theme) }
            else -> flowOf(emptyList())
        }

        return themeFlow.flatMapLatest { themes ->
            val start = findStartIndex(themes, themeId)
            val animeIds = themes.mapNotNull { it.animeId }.distinct()
            if (animeIds.isEmpty()) {
                flowOf(PlayerQueueState(themes, start, emptyMap()))
            } else {
                animeDao.observeByAnimeThemesIds(animeIds).map { animeList ->
                    val animeMap = animeList.mapNotNull { entry ->
                        entry.animeThemesId?.let { id -> id to entry }
                    }.toMap()
                    PlayerQueueState(themes, start, animeMap)
                }
            }
        }
    }

    private fun findStartIndex(themes: List<ThemeEntity>, themeId: Long?): Int {
        if (themeId == null) return 0
        val index = themes.indexOfFirst { it.id == themeId }
        return if (index == -1) 0 else index
    }
}

data class PlayerQueueState(
    val themes: List<ThemeEntity>,
    val startIndex: Int,
    val animeByThemesId: Map<Long, AnimeEntity>
) {
    companion object {
        fun empty() = PlayerQueueState(emptyList(), 0, emptyMap())
    }
}
