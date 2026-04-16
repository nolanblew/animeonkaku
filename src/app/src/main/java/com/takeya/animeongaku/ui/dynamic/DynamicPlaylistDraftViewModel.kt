package com.takeya.animeongaku.ui.dynamic

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.repository.DynamicPlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ---------------------------------------------------------------------------
// Supporting enums & sealed types
// ---------------------------------------------------------------------------

enum class TimeMode {
    ANY,
    LAST_6_MONTHS,
    LAST_2_YEARS,
    BEFORE_2000,
    Y2000_2010,
    Y2010_2020,
    CUSTOM
}

enum class TimeDimension { AIRED, WATCHED }
enum class RatingSource { MINE, AVERAGE }

sealed interface CustomRange {
    data class Relative(val durationMillis: Long) : CustomRange
    data class Exact(val startYear: Int, val endYear: Int) : CustomRange
}

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

data class SimpleSectionsState(
    val timeMode: TimeMode = TimeMode.ANY,
    val customRange: CustomRange? = null,
    val timeDimension: TimeDimension = TimeDimension.AIRED,
    val seasons: Set<Season> = emptySet(),
    val genreSlugs: Set<String> = emptySet(),
    val genreMatchAll: Boolean = false,
    val minRating: Double? = null,
    val ratingSource: RatingSource = RatingSource.MINE,
    val subtypes: Set<String> = emptySet(),
    val watchingStatuses: Set<String> = emptySet(),
    val themeTypes: Set<String> = emptySet()
)

data class DynamicDraftState(
    val createdMode: String = "SIMPLE",   // "SIMPLE" | "ADVANCED"
    val simple: SimpleSectionsState = SimpleSectionsState(),
    val advancedTree: FilterNode = FilterNode.And(emptyList()),
    val draftName: String = "",
    val saveMode: String = "AUTO",        // "AUTO" | "SNAPSHOT"
    val availableGenres: List<GenreEntity> = emptyList(),
    val editingPlaylistId: Long? = null
)

data class PreviewResult(val count: Int, val tracks: List<PlaylistTrack>)

// ---------------------------------------------------------------------------
// Compile helper
// ---------------------------------------------------------------------------

private fun DynamicDraftState.compileToFilterNode(): FilterNode {
    if (createdMode == "ADVANCED") return advancedTree

    val children = mutableListOf<FilterNode>()
    val s = simple

    // Time
    when (s.timeMode) {
        TimeMode.ANY -> { /* no filter */ }
        TimeMode.LAST_6_MONTHS -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                children += FilterNode.LibraryUpdatedWithin(182L * 24 * 60 * 60 * 1000)
            }
        }
        TimeMode.LAST_2_YEARS -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                children += FilterNode.LibraryUpdatedWithin(730L * 24 * 60 * 60 * 1000)
            }
        }
        TimeMode.BEFORE_2000 -> children += FilterNode.AiredBefore(2000)
        TimeMode.Y2000_2010 -> children += FilterNode.AiredBetween(2000, 2010)
        TimeMode.Y2010_2020 -> children += FilterNode.AiredBetween(2010, 2020)
        TimeMode.CUSTOM -> {
            val range = s.customRange
            if (range != null) {
                when {
                    range is CustomRange.Relative && s.timeDimension == TimeDimension.WATCHED ->
                        children += FilterNode.LibraryUpdatedWithin(range.durationMillis)
                    range is CustomRange.Exact && s.timeDimension == TimeDimension.AIRED ->
                        children += FilterNode.AiredBetween(range.startYear, range.endYear)
                    else -> { /* no-op for unsupported combo */ }
                }
            }
        }
    }

    // Seasons
    if (s.seasons.isNotEmpty()) {
        children += FilterNode.SeasonIn(s.seasons.toList())
    }

    // Genres
    if (s.genreSlugs.isNotEmpty()) {
        children += FilterNode.GenreIn(s.genreSlugs.toList(), s.genreMatchAll)
    }

    // Rating
    s.minRating?.let { min ->
        children += if (s.ratingSource == RatingSource.MINE) {
            FilterNode.UserRatingGte(min)
        } else {
            FilterNode.AverageRatingGte(min)
        }
    }

    // Subtypes
    if (s.subtypes.isNotEmpty()) {
        children += FilterNode.SubtypeIn(s.subtypes.toList())
    }

    // Watching statuses
    if (s.watchingStatuses.isNotEmpty()) {
        children += FilterNode.WatchingStatusIn(s.watchingStatuses.toList())
    }

    // Theme types
    if (s.themeTypes.isNotEmpty()) {
        children += FilterNode.ThemeTypeIn(s.themeTypes.toList())
    }

    return FilterNode.And(children)
}

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class DynamicPlaylistDraftViewModel @Inject constructor(
    private val repository: DynamicPlaylistRepository,
    private val genreDao: GenreDao,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val _state = MutableStateFlow(DynamicDraftState())
    val state: StateFlow<DynamicDraftState> = _state.asStateFlow()

    val previewResult: StateFlow<PreviewResult> = _state
        .map { it.compileToFilterNode() }
        .debounce(250)
        .mapLatest { filter ->
            val count = repository.previewCount(filter)
            val tracks = repository.previewTracks(filter, 20)
            PreviewResult(count, tracks)
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = PreviewResult(0, emptyList())
        )

    init {
        viewModelScope.launch {
            genreDao.observeAllGenres().collect { genres ->
                _state.update { it.copy(availableGenres = genres) }
            }
        }
    }

    // --- Events ---

    fun setDraftName(name: String) {
        _state.update { it.copy(draftName = name) }
    }

    fun setSaveMode(mode: String) {
        _state.update { it.copy(saveMode = mode) }
    }

    fun toggleGenreSlug(slug: String) {
        _state.update { s ->
            val updated = if (slug in s.simple.genreSlugs) {
                s.simple.genreSlugs - slug
            } else {
                s.simple.genreSlugs + slug
            }
            s.copy(simple = s.simple.copy(genreSlugs = updated))
        }
    }

    fun setGenreMatchAll(matchAll: Boolean) {
        _state.update { s -> s.copy(simple = s.simple.copy(genreMatchAll = matchAll)) }
    }

    fun setTimeMode(mode: TimeMode) {
        _state.update { s -> s.copy(simple = s.simple.copy(timeMode = mode)) }
    }

    fun setTimeDimension(dim: TimeDimension) {
        _state.update { s -> s.copy(simple = s.simple.copy(timeDimension = dim)) }
    }

    fun toggleSeason(season: Season) {
        _state.update { s ->
            val updated = if (season in s.simple.seasons) {
                s.simple.seasons - season
            } else {
                s.simple.seasons + season
            }
            s.copy(simple = s.simple.copy(seasons = updated))
        }
    }

    fun setMinRating(min: Double?) {
        _state.update { s -> s.copy(simple = s.simple.copy(minRating = min)) }
    }

    fun setRatingSource(source: RatingSource) {
        _state.update { s -> s.copy(simple = s.simple.copy(ratingSource = source)) }
    }

    fun toggleSubtype(subtype: String) {
        _state.update { s ->
            val updated = if (subtype in s.simple.subtypes) {
                s.simple.subtypes - subtype
            } else {
                s.simple.subtypes + subtype
            }
            s.copy(simple = s.simple.copy(subtypes = updated))
        }
    }

    fun toggleWatchingStatus(status: String) {
        _state.update { s ->
            val updated = if (status in s.simple.watchingStatuses) {
                s.simple.watchingStatuses - status
            } else {
                s.simple.watchingStatuses + status
            }
            s.copy(simple = s.simple.copy(watchingStatuses = updated))
        }
    }

    fun toggleThemeType(type: String) {
        _state.update { s ->
            val updated = if (type in s.simple.themeTypes) {
                s.simple.themeTypes - type
            } else {
                s.simple.themeTypes + type
            }
            s.copy(simple = s.simple.copy(themeTypes = updated))
        }
    }

    fun setCustomRange(range: CustomRange?) {
        _state.update { s -> s.copy(simple = s.simple.copy(customRange = range)) }
    }

    fun savePlaylist(): Flow<Long> = flow {
        val s = _state.value
        val filter = s.compileToFilterNode()
        val id = repository.createDynamic(
            name = s.draftName.ifBlank { "Smart Playlist" },
            filter = filter,
            mode = s.saveMode,
            createdMode = s.createdMode
        )
        emit(id)
    }

    fun loadForEdit(playlistId: Long) {
        _state.update { it.copy(editingPlaylistId = playlistId) }
        viewModelScope.launch {
            val spec = repository.observeSpec(playlistId)
            spec.collect { entity ->
                if (entity != null) {
                    _state.update { s ->
                        s.copy(
                            saveMode = entity.mode,
                            createdMode = entity.createdMode,
                            editingPlaylistId = playlistId
                        )
                    }
                    return@collect
                }
            }
        }
    }

    fun updateExistingPlaylist(): Flow<Unit> = flow {
        val s = _state.value
        val id = s.editingPlaylistId ?: return@flow
        val filter = s.compileToFilterNode()
        repository.updateDynamic(id, filter)
        emit(Unit)
    }

    fun promoteToAdvanced() {
        _state.update { s ->
            val compiled = s.compileToFilterNode()
            s.copy(createdMode = "ADVANCED", advancedTree = compiled)
        }
    }

    fun setAdvancedTree(tree: FilterNode) {
        _state.update { it.copy(advancedTree = tree) }
    }
}
