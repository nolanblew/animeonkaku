package com.takeya.animeongaku.ui.dynamic

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.RatingSource
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.filter.SimpleSectionsState
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.filter.TimeDimension
import com.takeya.animeongaku.data.filter.TimeMode
import com.takeya.animeongaku.data.filter.compileSimpleFilter
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
// State types
// ---------------------------------------------------------------------------

data class DynamicDraftState(
    val createdMode: String = "SIMPLE",   // "SIMPLE" | "ADVANCED"
    val simple: SimpleSectionsState = SimpleSectionsState(),
    val advancedTree: FilterNode = FilterNode.And(emptyList()),
    val draftName: String = "",
    val saveMode: String = "AUTO",        // "AUTO" | "SNAPSHOT"
    val availableGenres: List<GenreEntity> = emptyList(),
    val editingPlaylistId: Long? = null,
    val isEditLocked: Boolean = false,
    val sort: SortSpec = SortSpec.DEFAULT
)

data class PreviewResult(val count: Int, val tracks: List<PlaylistTrack>)

sealed interface SavePlaylistResult {
    data class Success(val playlistId: Long) : SavePlaylistResult
    data class Failure(val message: String) : SavePlaylistResult
}

// ---------------------------------------------------------------------------
// Compile / validate helpers
// ---------------------------------------------------------------------------

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
        val simpleState = if (s.createdMode == "SIMPLE") s.simple else null
        val result = runCatching {
            repository.createDynamic(
                name = s.draftName.ifBlank { "Smart Playlist" },
                filter = filter,
                mode = s.saveMode,
                createdMode = s.createdMode,
                sort = s.sort,
                simpleState = simpleState
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
            repository.observeSpec(playlistId).collect { entity ->
                if (entity != null) {
                    val storedSort = repository.decodeSort(entity)
                    val storedFilter = repository.decodeFilter(entity)
                    val storedSimple = repository.decodeSimpleState(entity)
                    val isSimple = entity.createdMode == "SIMPLE"

                    _state.update { s ->
                        s.copy(
                            saveMode = entity.mode,
                            createdMode = entity.createdMode,
                            editingPlaylistId = playlistId,
                            isEditLocked = true,
                            sort = storedSort,
                            simple = storedSimple ?: SimpleSectionsState(),
                            advancedTree = if (!isSimple) storedFilter ?: FilterNode.And(emptyList())
                                          else s.advancedTree
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
        val simpleState = if (s.createdMode == "SIMPLE") s.simple else null
        repository.updateDynamic(id, filter, s.sort, simpleState)
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
            val key = if (attribute.valueKind == com.takeya.animeongaku.data.filter.SortValueKind.CATEGORICAL) {
                SortKey(attribute, direction, SortKey.defaultCategoricalOrder(attribute))
            } else {
                SortKey(attribute, direction)
            }
            s.copy(sort = SortSpec(s.sort.keys + key))
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
            val newKey = if (attribute.valueKind == com.takeya.animeongaku.data.filter.SortValueKind.CATEGORICAL) {
                SortKey(attribute, SortDirection.ASC, SortKey.defaultCategoricalOrder(attribute))
            } else {
                keys[index].copy(attribute = attribute, categoricalOrder = null)
            }
            keys[index] = newKey
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

    fun setCategoricalOrder(index: Int, order: List<String>) {
        _state.update { s ->
            if (index !in s.sort.keys.indices) return@update s
            val keys = s.sort.keys.toMutableList()
            keys[index] = keys[index].copy(categoricalOrder = order)
            s.copy(sort = SortSpec(keys))
        }
    }

    fun resetSortToDefault() {
        _state.update { it.copy(sort = SortSpec.DEFAULT) }
    }
}
