package com.takeya.animeongaku.ui.library

import com.takeya.animeongaku.data.repository.MusicRequest
import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.MusicRequestScope
import com.takeya.animeongaku.data.repository.MusicRequestScopeStatus
import com.takeya.animeongaku.data.repository.MusicRequestState
import com.takeya.animeongaku.data.repository.MusicRequestStatus
import com.takeya.animeongaku.ui.common.ActionSheetAction
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

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

data class MusicRequestScopeUiState(
    val scope: MusicRequestScope,
    val progress: MusicRequestUiState,
    val active: Boolean,
    val eligibleCount: Int,
    val availableCount: Int,
    val missingCount: Int,
    val statusLoaded: Boolean
) {
    companion object {
        fun loading(scope: MusicRequestScope) = MusicRequestScopeUiState(
            scope = scope,
            progress = MusicRequestUiState.Hydrating,
            active = false,
            eligibleCount = 0,
            availableCount = 0,
            missingCount = 0,
            statusLoaded = false
        )
    }
}

data class MusicRequestScreenState(
    val scopes: Map<MusicRequestScope, MusicRequestScopeUiState>
) {
    operator fun get(scope: MusicRequestScope): MusicRequestScopeUiState =
        scopes[scope] ?: MusicRequestScopeUiState.loading(scope)

    fun updated(scope: MusicRequestScope, transform: (MusicRequestScopeUiState) -> MusicRequestScopeUiState) =
        copy(scopes = scopes + (scope to transform(get(scope))))

    companion object {
        fun loading() = of(*MusicRequestScope.entries.map(MusicRequestScopeUiState::loading).toTypedArray())
        fun of(vararg states: MusicRequestScopeUiState) = MusicRequestScreenState(states.associateBy { it.scope })
    }
}

class MusicRequestCoordinator(
    private val repository: MusicRequestRepository,
    private val scope: CoroutineScope,
    private val defaultPollDelayMillis: Long = 5_000,
    private val onCatalogRefreshNeeded: () -> Unit = {}
) {
    private val _state = MutableStateFlow(MusicRequestScreenState.loading())
    val state: StateFlow<MusicRequestScreenState> = _state.asStateFlow()

    private val statusMutex = Mutex()
    private var hydrateJob: Job? = null
    private var kitsuId: String? = null
    private val submissionJobs = mutableMapOf<MusicRequestScope, Job>()
    private val pollJobs = mutableMapOf<MusicRequestScope, Job>()
    private val pollRequestIds = mutableMapOf<MusicRequestScope, String>()
    private val statusRetryRequestIds = mutableMapOf<MusicRequestScope, String>()

    fun hydrate(kitsuId: String) {
        this.kitsuId = kitsuId
        hydrateJob?.cancel()
        pollJobs.values.forEach(Job::cancel)
        pollJobs.clear()
        pollRequestIds.clear()
        _state.value = MusicRequestScreenState.loading()
        hydrateJob = scope.launch { refreshStatus(kitsuId, showFailure = true) }
    }

    fun request(kitsuId: String, requestScope: MusicRequestScope) {
        val current = _state.value[requestScope]
        if (submissionJobs[requestScope]?.isActive == true || !current.canSubmit()) return

        this.kitsuId = kitsuId
        statusRetryRequestIds.remove(requestScope)
        _state.value = _state.value.updated(requestScope) {
            it.copy(progress = MusicRequestUiState.Submitting, active = false)
        }
        submissionJobs[requestScope] = scope.launch {
            try {
                val submitted = repository.request(kitsuId, requestScope)
                updateFromRequest(submitted)
                refreshStatus(kitsuId, showFailure = false)
                ensurePolling(kitsuId, submitted)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _state.value = _state.value.updated(requestScope) {
                    it.copy(
                        progress = MusicRequestUiState.SubmissionError(
                            "Could not request ${requestScope.displayName.lowercase()}. Try again."
                        ),
                        active = false
                    )
                }
            }
        }
    }

    fun retryStatus(requestScope: MusicRequestScope) {
        if (submissionJobs[requestScope]?.isActive == true) return
        val currentKitsuId = kitsuId ?: return
        val requestId = statusRetryRequestIds[requestScope]
        if (requestId == null) {
            hydrate(currentKitsuId)
            return
        }
        submissionJobs[requestScope] = scope.launch {
            try {
                val request = repository.get(requestId)
                statusRetryRequestIds.remove(requestScope)
                updateFromRequest(request)
                refreshStatus(currentKitsuId, showFailure = false)
                ensurePolling(currentKitsuId, request)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                showPollFailure(requestScope, requestId)
            }
        }
    }

    fun cancel() {
        hydrateJob?.cancel()
        submissionJobs.values.forEach(Job::cancel)
        pollJobs.values.forEach(Job::cancel)
        submissionJobs.clear()
        pollJobs.clear()
        pollRequestIds.clear()
    }

    private suspend fun refreshStatus(kitsuId: String, showFailure: Boolean) {
        try {
            val status = statusMutex.withLock { repository.status(kitsuId) }
            applyStatus(kitsuId, status)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            if (showFailure) {
                _state.value = MusicRequestScreenState.of(
                    *MusicRequestScope.entries.map { requestScope ->
                        MusicRequestScopeUiState.loading(requestScope).copy(
                            progress = MusicRequestUiState.StatusError(
                                "Could not load request status. Try again."
                            )
                        )
                    }.toTypedArray()
                )
            }
        }
    }

    private fun applyStatus(kitsuId: String, status: MusicRequestStatus) {
        val mapped = MusicRequestScope.entries.map { requestScope ->
            status[requestScope].toUiState()
        }
        _state.value = MusicRequestScreenState.of(*mapped.toTypedArray())

        mapped.forEach { scopeState ->
            val latest = status[scopeState.scope].latest
            if (scopeState.active && latest != null) {
                ensurePolling(kitsuId, latest)
            } else if (pollJobs[scopeState.scope]?.isActive != true) {
                pollJobs.remove(scopeState.scope)?.cancel()
                pollRequestIds.remove(scopeState.scope)
            }
        }
    }

    private fun ensurePolling(kitsuId: String, request: MusicRequest) {
        if (!request.active || request.state.isTerminal) return
        val requestScope = request.scope
        if (pollJobs[requestScope]?.isActive == true && pollRequestIds[requestScope] == request.id) return

        pollJobs.remove(requestScope)?.cancel()
        pollRequestIds[requestScope] = request.id
        pollJobs[requestScope] = scope.launch {
            try {
                var current = request
                while (current.active && !current.state.isTerminal) {
                    delay(current.pollAfterSeconds?.times(1_000L) ?: defaultPollDelayMillis)
                    try {
                        val next = repository.get(current.id)
                        statusRetryRequestIds.remove(requestScope)
                        val changed = next.state != current.state || next.lastUpdatedAt != current.lastUpdatedAt
                        current = next
                        updateFromRequest(next)
                        if (changed) {
                            onCatalogRefreshNeeded()
                            refreshStatus(kitsuId, showFailure = false)
                        }
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        showPollFailure(requestScope, current.id)
                        return@launch
                    }
                }
            } finally {
                if (pollRequestIds[requestScope] == request.id) {
                    pollRequestIds.remove(requestScope)
                    pollJobs.remove(requestScope)
                }
            }
        }
    }

    private fun updateFromRequest(request: MusicRequest) {
        _state.value = _state.value.updated(request.scope) {
            it.copy(progress = request.toUiState(), active = request.active, statusLoaded = true)
        }
    }

    private fun showPollFailure(requestScope: MusicRequestScope, requestId: String) {
        statusRetryRequestIds[requestScope] = requestId
        _state.value = _state.value.updated(requestScope) {
            it.copy(
                progress = MusicRequestUiState.StatusError(
                    "Could not refresh request status. Try again."
                ),
                active = true
            )
        }
    }
}

private fun MusicRequestScopeStatus.toUiState() = MusicRequestScopeUiState(
    scope = scope,
    progress = latest?.toUiState() ?: MusicRequestUiState.Idle,
    active = active,
    eligibleCount = eligibleCount,
    availableCount = availableCount,
    missingCount = missingCount,
    statusLoaded = true
)

private fun MusicRequestScopeUiState.canSubmit(): Boolean =
    statusLoaded && eligibleCount > 0 && missingCount > 0 && !active &&
        progress !is MusicRequestUiState.Submitting && progress !is MusicRequestUiState.StatusError

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
    val visible: Boolean,
    val label: String,
    val supportingText: String? = null,
    val statusDescription: String,
    val enabled: Boolean
)

internal val MusicRequestScope.displayName: String
    get() = when (this) {
        MusicRequestScope.FULL_SONGS -> "Full Songs"
        MusicRequestScope.EXTRA_MUSIC -> "Extra Music"
    }

internal fun musicRequestActionPresentation(state: MusicRequestScopeUiState): MusicRequestActionPresentation {
    val requestLabel = "Request ${state.scope.displayName}"
    if (state.progress is MusicRequestUiState.StatusError && !state.active) {
        return MusicRequestActionPresentation(
            visible = true,
            label = "Retry status",
            supportingText = state.progress.message,
            statusDescription = state.progress.message,
            enabled = true
        )
    }
    if (!state.statusLoaded) {
        return MusicRequestActionPresentation(
            visible = true,
            label = requestLabel,
            supportingText = "Loading request status",
            statusDescription = "Loading ${state.scope.displayName.lowercase()} request status",
            enabled = false
        )
    }
    if (state.eligibleCount <= 0 || state.missingCount <= 0) {
        return MusicRequestActionPresentation(false, requestLabel, statusDescription = requestLabel, enabled = false)
    }

    val progressText = state.progress.supportingText()
    if (state.active || state.progress == MusicRequestUiState.Submitting) {
        return MusicRequestActionPresentation(
            visible = true,
            label = requestLabel,
            supportingText = progressText ?: "Already requested",
            statusDescription = progressText ?: "Already requested",
            enabled = false
        )
    }
    if (state.progress is MusicRequestUiState.SubmissionError) {
        return MusicRequestActionPresentation(
            visible = true,
            label = "Retry ${state.scope.displayName}",
            supportingText = state.progress.message,
            statusDescription = state.progress.message,
            enabled = true
        )
    }

    val retry = state.progress is MusicRequestUiState.CompletedWithWarnings ||
        state.progress is MusicRequestUiState.TerminalAttention
    val label = if (retry) "Retry ${state.scope.displayName}" else requestLabel
    return MusicRequestActionPresentation(
        visible = true,
        label = label,
        supportingText = if (retry) progressText else "${state.missingCount} missing",
        statusDescription = label,
        enabled = true
    )
}

private fun MusicRequestUiState.supportingText(): String? = when (this) {
    MusicRequestUiState.Hydrating -> "Loading request status"
    MusicRequestUiState.Idle -> null
    MusicRequestUiState.Submitting -> "Submitting request"
    is MusicRequestUiState.Queued -> "Waiting to start"
    is MusicRequestUiState.Searching -> "Searching sources"
    is MusicRequestUiState.Downloading -> "Downloads in progress"
    is MusicRequestUiState.Processing -> "Preparing requested audio"
    is MusicRequestUiState.AwaitingOperator -> "Operator review required"
    is MusicRequestUiState.Completed -> "Request completed"
    is MusicRequestUiState.CompletedWithWarnings -> "Completed with warnings; missing music can be retried"
    is MusicRequestUiState.TerminalAttention -> "Request needs attention; missing music can be retried"
    is MusicRequestUiState.SubmissionError -> message
    is MusicRequestUiState.StatusError -> message
}

internal fun musicRequestActionSheetActions(state: MusicRequestScreenState): List<ActionSheetAction> =
    MusicRequestScope.entries.mapNotNull { requestScope ->
        val presentation = musicRequestActionPresentation(state[requestScope])
        presentation.takeIf { it.visible }?.let {
            ActionSheetAction(
                key = musicRequestActionKey(requestScope),
                label = it.label,
                supportingText = it.supportingText,
                enabled = it.enabled
            )
        }
    }

internal fun musicRequestActionKey(scope: MusicRequestScope): String = "music_request_${scope.name}"

internal fun musicRequestScopeForAction(key: String): MusicRequestScope? =
    MusicRequestScope.entries.firstOrNull { musicRequestActionKey(it) == key }
