package com.takeya.animeongaku.ui.dynamic

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.data.local.GenreDao
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.repository.DynamicPlaylistRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.ZoneOffset
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
    val editingPlaylistId: Long? = null,
    val sort: SortSpec = SortSpec.DEFAULT
)

data class PreviewResult(val count: Int, val tracks: List<PlaylistTrack>)

sealed interface SavePlaylistResult {
    data class Success(val playlistId: Long) : SavePlaylistResult
    data class Failure(val message: String) : SavePlaylistResult
}

// ---------------------------------------------------------------------------
// Compile helper
// ---------------------------------------------------------------------------

internal fun compileSimpleFilter(simpleState: SimpleSectionsState): FilterNode {
    val children = mutableListOf<FilterNode>()
    val s = simpleState

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
        TimeMode.BEFORE_2000 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(endYearInclusive = 1999)?.let(children::add)
            } else {
                children += FilterNode.AiredBefore(2000)
            }
        }
        TimeMode.Y2000_2010 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(startYearInclusive = 2000, endYearInclusive = 2010)?.let(children::add)
            } else {
                children += FilterNode.AiredBetween(2000, 2010)
            }
        }
        TimeMode.Y2010_2020 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(startYearInclusive = 2010, endYearInclusive = 2020)?.let(children::add)
            } else {
                children += FilterNode.AiredBetween(2010, 2020)
            }
        }
        TimeMode.CUSTOM -> {
            val range = s.customRange
            if (range != null) {
                when {
                    range is CustomRange.Relative && s.timeDimension == TimeDimension.WATCHED ->
                        children += FilterNode.LibraryUpdatedWithin(range.durationMillis)
                    range is CustomRange.Exact && s.timeDimension == TimeDimension.AIRED ->
                        children += FilterNode.AiredBetween(range.startYear, range.endYear)
                    range is CustomRange.Exact && s.timeDimension == TimeDimension.WATCHED -> {
                        val startYear = minOf(range.startYear, range.endYear)
                        val endYear = maxOf(range.startYear, range.endYear)
                        watchedYearFilter(startYear, endYear)?.let(children::add)
                    }
                    else -> { /* no filter */ }
                }
            }
        }
    }

    if (s.seasons.isNotEmpty()) {
        children += FilterNode.SeasonIn(s.seasons.toList())
    }

    if (s.genreSlugs.isNotEmpty()) {
        children += FilterNode.GenreIn(s.genreSlugs.toList(), s.genreMatchAll)
    }

    s.minRating?.let { min ->
        children += if (s.ratingSource == RatingSource.MINE) {
            FilterNode.UserRatingGte(min)
        } else {
            FilterNode.AverageRatingGte(min)
        }
    }

    if (s.subtypes.isNotEmpty()) {
        children += FilterNode.SubtypeIn(s.subtypes.toList())
    }

    if (s.watchingStatuses.isNotEmpty()) {
        children += FilterNode.WatchingStatusIn(s.watchingStatuses.toList())
    }

    if (s.themeTypes.isNotEmpty()) {
        children += FilterNode.ThemeTypeIn(s.themeTypes.toList())
    }

    return FilterNode.And(children)
}

private fun DynamicDraftState.compileToFilterNode(): FilterNode {
    if (createdMode == "ADVANCED") return advancedTree
    return compileSimpleFilter(simple)
}

internal fun validateDraft(state: DynamicDraftState): String? {
    if (state.createdMode != "ADVANCED") return null
    return validateAdvancedTree(state.advancedTree, isRoot = true)
}

private fun validateAdvancedTree(node: FilterNode, isRoot: Boolean): String? {
    return when (node) {
        is FilterNode.And -> validateGroup(node.children, isRoot)
        is FilterNode.Or -> validateGroup(node.children, isRoot)
        is FilterNode.Not -> validateAdvancedTree(node.child, isRoot = false)
        else -> null
    }
}

private fun validateGroup(children: List<FilterNode>, isRoot: Boolean): String? {
    if (children.isEmpty()) {
        return if (isRoot) {
            "Add at least one attribute or group before saving."
        } else {
            "Remove or fill empty groups before saving."
        }
    }
    return children.firstNotNullOfOrNull { child ->
        validateAdvancedTree(child, isRoot = false)
    }
}

private fun Throwable.toPlaylistSaveMessage(): String {
    return message?.takeIf { it.isNotBlank() }
        ?: "Couldn't save this smart playlist. Try removing the last filter change and try again."
}

private fun watchedYearFilter(
    startYearInclusive: Int? = null,
    endYearInclusive: Int? = null
): FilterNode? {
    val clauses = mutableListOf<FilterNode>()

    startYearInclusive?.let { startYear ->
        clauses += FilterNode.LibraryUpdatedAfter(startOfYearUtcMillis(startYear) - 1L)
    } ?: run {
        clauses += FilterNode.LibraryUpdatedAfter(0L)
    }

    endYearInclusive?.let { endYear ->
        clauses += FilterNode.Not(
            FilterNode.LibraryUpdatedAfter(startOfYearUtcMillis(endYear + 1) - 1L)
        )
    }

    return when (clauses.size) {
        0 -> null
        1 -> clauses.single()
        else -> FilterNode.And(clauses)
    }
}

private fun startOfYearUtcMillis(year: Int): Long {
    return LocalDate.of(year, 1, 1)
        .atStartOfDay()
        .toInstant(ZoneOffset.UTC)
        .toEpochMilli()
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

    val validationMessage: StateFlow<String?> = _state
        .map(::validateDraft)
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = validateDraft(_state.value)
        )

    val previewResult: StateFlow<PreviewResult> = _state
        .debounce(250)
        .mapLatest { draft ->
            val validationError = validateDraft(draft)
            if (validationError != null) {
                PreviewResult(0, emptyList())
            } else {
                runCatching {
                    val filter = draft.compileToFilterNode()
                    val count = repository.previewCount(filter)
                    val tracks = repository.previewTracks(filter, draft.sort, 20)
                    PreviewResult(count, tracks)
                }.getOrElse {
                    PreviewResult(0, emptyList())
                }
            }
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

    fun savePlaylist(): Flow<SavePlaylistResult> = flow {
        val s = _state.value
        val validationError = validateDraft(s)
        if (validationError != null) {
            emit(SavePlaylistResult.Failure(validationError))
            return@flow
        }
        val filter = s.compileToFilterNode()
        val result = runCatching {
            repository.createDynamic(
                name = s.draftName.ifBlank { "Smart Playlist" },
                filter = filter,
                mode = s.saveMode,
                createdMode = s.createdMode,
                sort = s.sort
            )
        }
        emit(
            result.fold(
                onSuccess = { SavePlaylistResult.Success(it) },
                onFailure = { SavePlaylistResult.Failure(it.toPlaylistSaveMessage()) }
            )
        )
    }

    fun loadForEdit(playlistId: Long) {
        _state.update { it.copy(editingPlaylistId = playlistId) }
        viewModelScope.launch {
            val spec = repository.observeSpec(playlistId)
            spec.collect { entity ->
                if (entity != null) {
                    val storedSort = repository.decodeSort(entity)
                    _state.update { s ->
                        s.copy(
                            saveMode = entity.mode,
                            createdMode = entity.createdMode,
                            editingPlaylistId = playlistId,
                            sort = storedSort
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
        repository.updateDynamic(id, filter, s.sort)
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

    // --- Sort editing ---

    fun setSort(spec: SortSpec) {
        val clamped = if (spec.keys.size > SortSpec.MAX_KEYS) {
            SortSpec(spec.keys.take(SortSpec.MAX_KEYS))
        } else {
            spec
        }
        _state.update { it.copy(sort = clamped) }
    }

    fun addSortKey(attribute: SortAttribute, direction: SortDirection = SortDirection.ASC) {
        _state.update { s ->
            if (s.sort.keys.size >= SortSpec.MAX_KEYS) return@update s
            s.copy(sort = SortSpec(s.sort.keys + SortKey(attribute, direction)))
        }
    }

    fun removeSortKey(index: Int) {
        _state.update { s ->
            if (index !in s.sort.keys.indices) return@update s
            s.copy(sort = SortSpec(s.sort.keys.toMutableList().also { it.removeAt(index) }))
        }
    }

    fun moveSortKey(fromIndex: Int, toIndex: Int) {
        _state.update { s ->
            val keys = s.sort.keys.toMutableList()
            if (fromIndex !in keys.indices || toIndex !in 0..keys.size) return@update s
            val item = keys.removeAt(fromIndex)
            val target = toIndex.coerceIn(0, keys.size)
            keys.add(target, item)
            s.copy(sort = SortSpec(keys))
        }
    }

    fun setSortAttribute(index: Int, attribute: SortAttribute) {
        _state.update { s ->
            if (index !in s.sort.keys.indices) return@update s
            val keys = s.sort.keys.toMutableList()
            keys[index] = keys[index].copy(attribute = attribute)
            s.copy(sort = SortSpec(keys))
        }
    }

    fun setSortDirection(index: Int, direction: SortDirection) {
        _state.update { s ->
            if (index !in s.sort.keys.indices) return@update s
            val keys = s.sort.keys.toMutableList()
            keys[index] = keys[index].copy(direction = direction)
            s.copy(sort = SortSpec(keys))
        }
    }

    fun resetSortToDefault() {
        _state.update { it.copy(sort = SortSpec.DEFAULT) }
    }
}
