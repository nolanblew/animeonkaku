package com.takeya.animeongaku.ui.explore

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.model.AnimeThemeEntry
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.media.NowPlayingManager
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlin.math.abs
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

@HiltViewModel
class ExploreViewModel @Inject constructor(
    private val animeRepository: AnimeRepository,
    private val themeDao: ThemeDao,
    private val nowPlayingManager: NowPlayingManager
) : ViewModel() {
    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _results = MutableStateFlow<List<AnimeThemeEntry>>(emptyList())
    val results: StateFlow<List<AnimeThemeEntry>> = _results.asStateFlow()

    private val _isSearching = MutableStateFlow(false)
    val isSearching: StateFlow<Boolean> = _isSearching.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var searchJob: Job? = null

    suspend fun saveAndPlayTheme(entry: AnimeThemeEntry) {
        val themeId = entry.themeId.toLongOrNull() ?: abs(entry.themeId.hashCode()).toLong()
        val animeId = entry.animeId.toLongOrNull()
        val entity = ThemeEntity(
            id = themeId,
            animeId = animeId,
            title = entry.title,
            artistName = entry.artist,
            audioUrl = entry.audioUrl,
            videoUrl = entry.videoUrl,
            isDownloaded = false,
            localFilePath = null,
            themeType = entry.themeType,
            source = ThemeEntity.SOURCE_USER
        )
        themeDao.upsertAll(listOf(entity))

        // Build context from all current search results
        val allEntities = _results.value.map { e ->
            val id = e.themeId.toLongOrNull() ?: abs(e.themeId.hashCode()).toLong()
            ThemeEntity(
                id = id,
                animeId = e.animeId.toLongOrNull(),
                title = e.title,
                artistName = e.artist,
                audioUrl = e.audioUrl,
                videoUrl = e.videoUrl,
                isDownloaded = false,
                localFilePath = null,
                themeType = e.themeType,
                source = ThemeEntity.SOURCE_USER
            )
        }
        val idx = allEntities.indexOfFirst { it.id == themeId }.coerceAtLeast(0)
        nowPlayingManager.play("Search: ${_query.value}", allEntities, idx)
    }

    fun onQueryChange(value: String) {
        _query.value = value
        _error.value = null
        searchJob?.cancel()
        if (value.isBlank()) {
            _results.value = emptyList()
            _isSearching.value = false
            return
        }
        searchJob = viewModelScope.launch {
            delay(400)
            _isSearching.value = true
            try {
                _results.value = animeRepository.searchAnimeThemes(value)
            } catch (e: Exception) {
                _error.value = "Search failed: ${e.message}"
            } finally {
                _isSearching.value = false
            }
        }
    }
}
