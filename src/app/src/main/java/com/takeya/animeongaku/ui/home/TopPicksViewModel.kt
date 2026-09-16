package com.takeya.animeongaku.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.repository.HomeTopPicksQuery
import com.takeya.animeongaku.data.repository.HomeTopPicksRepository
import com.takeya.animeongaku.data.repository.HomeTopPicksSnapshot
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlaybackPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

data class TopPicksState(
    val snapshot: HomeTopPicksSnapshot? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class TopPicksViewModel @Inject constructor(
    private val repository: HomeTopPicksRepository,
    private val playbackPreferences: PlaybackPreferences,
    val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    private val _state = MutableStateFlow(TopPicksState())
    val state: StateFlow<TopPicksState> = _state.asStateFlow()
    val showOstsOnHome: StateFlow<Boolean> = playbackPreferences.showOstsOnHomeFlow
        .stateIn(viewModelScope, SharingStarted.Eagerly, playbackPreferences.showOstsOnHome)
    private var loadJob: Job? = null
    private var currentQuery: HomeTopPicksQuery? = null

    fun load(filter: String?, includeExtras: Boolean = showOstsOnHome.value) {
        val normalizedFilter = when (filter) {
            "OP" -> "OP"
            "ED" -> "ED"
            else -> "ALL"
        }
        val query = HomeTopPicksQuery(includeExtras, normalizedFilter)
        loadJob?.cancel()
        currentQuery = query
        loadJob = viewModelScope.launch {
            _state.value = TopPicksState(isLoading = true)
            val cached = repository.cachedPreview(query)
            if (currentQuery != query) return@launch
            if (cached != null) _state.value = _state.value.copy(snapshot = cached)
            val full = repository.full(query)
            if (currentQuery != query) return@launch
            _state.value = _state.value.copy(
                snapshot = full ?: cached,
                isLoading = false,
                error = if (full == null) "Top picks could not be loaded. Try again when you're online." else null
            )
        }
    }

    fun play(): Boolean {
        val snapshot = _state.value.snapshot ?: return false
        val expected = minOf(snapshot.response.total, 60)
        if (snapshot.items.isEmpty() || snapshot.items.size < expected) {
            _state.value = _state.value.copy(error = "Top picks are still loading. Try again in a moment.")
            return false
        }
        nowPlayingManager.playItems("Top Picks", snapshot.items.map { it.item })
        return true
    }

    fun playItem(index: Int): Boolean {
        val snapshot = _state.value.snapshot ?: return false
        val expected = minOf(snapshot.response.total, 60)
        if (snapshot.items.isEmpty() || snapshot.items.size < expected || index !in snapshot.items.indices) {
            _state.value = _state.value.copy(error = "Top picks are still loading. Try again in a moment.")
            return false
        }
        val items = snapshot.items
        nowPlayingManager.playItems("Top Picks", items.map { it.item }, index)
        return true
    }

    fun retry() {
        load(currentQuery?.filter)
    }
}
