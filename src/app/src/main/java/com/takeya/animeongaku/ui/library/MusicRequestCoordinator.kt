package com.takeya.animeongaku.ui.library

import com.takeya.animeongaku.data.repository.MusicRequest
import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.MusicRequestState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface MusicRequestUiState {
    data object Hydrating : MusicRequestUiState
    data object Idle : MusicRequestUiState
    data object Submitting : MusicRequestUiState
    data class Queued(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class Searching(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class Downloading(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class Processing(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class AwaitingOperator(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class Completed(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class CompletedWithWarnings(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class TerminalAttention(val batchCount: Int, val fullThemeCount: Int = 0) : MusicRequestUiState
    data class SubmissionError(val message: String) : MusicRequestUiState
    data class StatusError(val message: String) : MusicRequestUiState
}

class MusicRequestCoordinator(
    private val repository: MusicRequestRepository,
    private val scope: CoroutineScope,
    private val defaultPollDelayMillis: Long = 5_000,
    private val onCatalogRefreshNeeded: () -> Unit = {}
) {
    private val _state = MutableStateFlow<MusicRequestUiState>(MusicRequestUiState.Idle)
    val state: StateFlow<MusicRequestUiState> = _state.asStateFlow()
    private var operation: Job? = null
    private var statusRetry: StatusRetry? = null

    fun hydrate(kitsuId: String) {
        operation?.cancel()
        _state.value = MusicRequestUiState.Hydrating
        operation = scope.launch {
            try {
                val request = repository.latest(kitsuId)
                statusRetry = null
                if (request == null) _state.value = MusicRequestUiState.Idle else observe(request)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                statusRetry = StatusRetry.Latest(kitsuId)
                _state.value = MusicRequestUiState.StatusError("Could not load request status. Try again.")
            }
        }
    }

    fun request(kitsuId: String) {
        if (operation?.isActive == true) return
        if (_state.value != MusicRequestUiState.Idle && _state.value !is MusicRequestUiState.SubmissionError) {
            return
        }
        operation?.cancel()
        statusRetry = null
        _state.value = MusicRequestUiState.Submitting
        operation = scope.launch {
            try {
                val submitted = repository.create(kitsuId)
                observe(submitted)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _state.value = MusicRequestUiState.SubmissionError("Could not request music. Try again.")
            }
        }
    }

    fun retryStatus() {
        if (operation?.isActive == true) return
        when (val retry = statusRetry) {
            is StatusRetry.Latest -> hydrate(retry.kitsuId)
            is StatusRetry.Current -> {
                _state.value = MusicRequestUiState.Hydrating
                operation = scope.launch {
                    try {
                        observe(repository.get(retry.request.id))
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        statusRetry = retry
                        _state.value = MusicRequestUiState.StatusError(
                            "Could not refresh request status. Try again."
                        )
                    }
                }
            }
            null -> Unit
        }
    }

    fun cancel() {
        operation?.cancel()
        operation = null
    }

    private suspend fun observe(initial: MusicRequest) {
        var current = initial
        var readyBatchCount = 0
        var catalogRefreshVersion: String? = null
        while (true) {
            statusRetry = null
            _state.value = current.toUiState()
            val currentReadyBatchCount = current.counts.completed + current.counts.completedWithWarnings
            if (currentReadyBatchCount > readyBatchCount ||
                (current.state.mayPublishCatalog && current.lastUpdatedAt != catalogRefreshVersion)
            ) {
                onCatalogRefreshNeeded()
                catalogRefreshVersion = current.lastUpdatedAt
            }
            readyBatchCount = maxOf(readyBatchCount, currentReadyBatchCount)
            if (current.state.isTerminal) return
            delay(current.pollAfterSeconds?.times(1_000L) ?: defaultPollDelayMillis)
            try {
                current = repository.get(current.id)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                statusRetry = StatusRetry.Current(current)
                _state.value = MusicRequestUiState.StatusError(
                    "Could not refresh request status. Try again."
                )
                return
            }
        }
    }

    private sealed interface StatusRetry {
        data class Latest(val kitsuId: String) : StatusRetry
        data class Current(val request: MusicRequest) : StatusRetry
    }
}

private val MusicRequestState.mayPublishCatalog: Boolean
    get() = this == MusicRequestState.PROCESSING || this == MusicRequestState.AWAITING_OPERATOR || isTerminal

private fun MusicRequest.toUiState(): MusicRequestUiState = when (state) {
    MusicRequestState.QUEUED -> MusicRequestUiState.Queued(batchCount, fullThemeCount)
    MusicRequestState.SEARCHING -> MusicRequestUiState.Searching(batchCount, fullThemeCount)
    MusicRequestState.AWAITING_OPERATOR -> MusicRequestUiState.AwaitingOperator(batchCount, fullThemeCount)
    MusicRequestState.DOWNLOADING -> MusicRequestUiState.Downloading(batchCount, fullThemeCount)
    MusicRequestState.PROCESSING -> MusicRequestUiState.Processing(batchCount, fullThemeCount)
    MusicRequestState.COMPLETED -> MusicRequestUiState.Completed(batchCount, fullThemeCount)
    MusicRequestState.COMPLETED_WITH_WARNINGS -> MusicRequestUiState.CompletedWithWarnings(batchCount, fullThemeCount)
    MusicRequestState.FAILED,
    MusicRequestState.CANCELLED,
    MusicRequestState.UNKNOWN -> MusicRequestUiState.TerminalAttention(batchCount, fullThemeCount)
}

data class MusicRequestActionPresentation(
    val label: String,
    val supportingText: String? = null,
    val statusDescription: String,
    val enabled: Boolean
)

internal fun shouldShowMusicRequestAction(
    isDebug: Boolean,
    @Suppress("UNUSED_PARAMETER") themeCount: Int,
    @Suppress("UNUSED_PARAMETER") isInLibrary: Boolean
): Boolean = isDebug

internal fun musicRequestActionPresentation(state: MusicRequestUiState, readyMusicAvailable: Boolean = false): MusicRequestActionPresentation =
    if (readyMusicAvailable) readyMusicPresentation(state) else
    when (state) {
        MusicRequestUiState.Hydrating -> MusicRequestActionPresentation("Loading request status", statusDescription = "Loading music request status", enabled = false)
        MusicRequestUiState.Idle -> MusicRequestActionPresentation("Request music", statusDescription = "Request all music for this anime", enabled = true)
        MusicRequestUiState.Submitting -> MusicRequestActionPresentation("Requesting music", statusDescription = "Submitting music request", enabled = false)
        is MusicRequestUiState.Queued -> state.presentation("Music request queued", "Waiting to start")
        is MusicRequestUiState.Searching -> state.presentation("Searching for music", "Searching sources")
        is MusicRequestUiState.Downloading -> state.presentation("Downloading music", "Downloads in progress")
        is MusicRequestUiState.Processing -> state.presentation("Processing music", "Preparing requested audio")
        is MusicRequestUiState.AwaitingOperator -> state.presentation("Needs operator review", "Operator review required")
        is MusicRequestUiState.Completed -> state.presentation("Music request completed", "Request completed")
        is MusicRequestUiState.CompletedWithWarnings -> state.presentation("Completed with warnings", "Request completed with warnings")
        is MusicRequestUiState.TerminalAttention -> state.presentation("Request needs attention", "Music request needs attention")
        is MusicRequestUiState.SubmissionError -> MusicRequestActionPresentation("Retry music request", state.message, state.message, enabled = true)
        is MusicRequestUiState.StatusError -> MusicRequestActionPresentation("Retry status", state.message, state.message, enabled = true)
    }

private fun readyMusicPresentation(state: MusicRequestUiState): MusicRequestActionPresentation = when (state) {
    is MusicRequestUiState.Completed -> MusicRequestActionPresentation(
        "Music is ready", "Available music is shown below.", "Music is ready", enabled = false
    )
    is MusicRequestUiState.AwaitingOperator,
    is MusicRequestUiState.CompletedWithWarnings,
    is MusicRequestUiState.TerminalAttention -> MusicRequestActionPresentation(
        "Some music is ready", "Available music is shown below. Some requested items could not be added.", "Some music is ready", enabled = false
    )
    is MusicRequestUiState.Queued,
    is MusicRequestUiState.Searching,
    is MusicRequestUiState.Downloading,
    is MusicRequestUiState.Processing -> MusicRequestActionPresentation(
        "Finding and preparing music", "Ready music will appear below automatically.", "Finding and preparing music", enabled = false
    )
    else -> MusicRequestActionPresentation(
        "Music is ready", "Available music is shown below.", "Music is ready", enabled = false
    )
}

private fun MusicRequestUiState.presentation(label: String, statusDescription: String): MusicRequestActionPresentation {
    val batchCountAndFullThemeCount = when (this) {
        is MusicRequestUiState.Queued -> batchCount to fullThemeCount
        is MusicRequestUiState.Searching -> batchCount to fullThemeCount
        is MusicRequestUiState.Downloading -> batchCount to fullThemeCount
        is MusicRequestUiState.Processing -> batchCount to fullThemeCount
        is MusicRequestUiState.AwaitingOperator -> batchCount to fullThemeCount
        is MusicRequestUiState.Completed -> batchCount to fullThemeCount
        is MusicRequestUiState.CompletedWithWarnings -> batchCount to fullThemeCount
        is MusicRequestUiState.TerminalAttention -> batchCount to fullThemeCount
        else -> 0 to 0
    }
    val (batchCount, fullThemeCount) = batchCountAndFullThemeCount
    return MusicRequestActionPresentation(
        label = label,
        supportingText = if (fullThemeCount > 0) {
            "$fullThemeCount full songs requested across $batchCount ${if (batchCount == 1) "batch" else "batches"}"
        } else {
            "$batchCount ${if (batchCount == 1) "batch" else "batches"} requested"
        },
        statusDescription = statusDescription,
        enabled = false
    )
}
