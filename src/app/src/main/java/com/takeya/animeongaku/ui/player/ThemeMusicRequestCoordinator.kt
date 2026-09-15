package com.takeya.animeongaku.ui.player

import com.takeya.animeongaku.data.repository.MusicRequestRepository
import com.takeya.animeongaku.data.repository.MusicRequestState
import com.takeya.animeongaku.data.repository.ThemeMusicRequestReason
import com.takeya.animeongaku.data.repository.ThemeMusicRequestResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import retrofit2.HttpException

data class ThemeMusicRequestTarget(val kitsuId: String, val themeId: Long, val title: String, val fullSizeSongId: Long? = null)

data class ThemeMusicRequestUiState(
    val target: ThemeMusicRequestTarget,
    val reason: ThemeMusicRequestReason,
    val busy: Boolean = true,
    val result: ThemeMusicRequestResult? = null,
    val error: String? = null
) {
    val message: String get() {
        error?.let { return it }
        if (busy) return "Contacting the server…"
        val result = result ?: return "Could not load request status."
        return when (result.request.state) {
            MusicRequestState.COMPLETED -> "Full-size request completed. Your existing downloads have been kept."
            MusicRequestState.COMPLETED_WITH_WARNINGS -> "The request finished with warnings. Check the fetcher for details. Your existing downloads have been kept."
            MusicRequestState.FAILED, MusicRequestState.CANCELLED, MusicRequestState.UNKNOWN ->
                "The request needs attention in the fetcher. Your existing downloads have been kept."
            MusicRequestState.AWAITING_OPERATOR -> "Waiting for manual selection in the fetcher. Your existing downloads have been kept."
            else -> if (result.manualSelectionRequired)
                "The song is queued for manual review in the fetcher. Your existing downloads have been kept."
            else "Full-size song requested. Your existing downloads have been kept."
        }
    }
}

/** Captures the selected song before an asynchronous request; playback never owns this state. */
class ThemeMusicRequestCoordinator(
    private val repository: MusicRequestRepository,
    private val scope: CoroutineScope,
    private val retainDownload: suspend (ThemeMusicRequestTarget) -> Unit = {}
) {
    private val _state = MutableStateFlow<ThemeMusicRequestUiState?>(null)
    val state = _state.asStateFlow()

    fun submit(target: ThemeMusicRequestTarget, reason: ThemeMusicRequestReason) {
        if (_state.value?.busy == true) return
        _state.value = ThemeMusicRequestUiState(target, reason)
        scope.launch {
            try {
                if (reason == ThemeMusicRequestReason.INCORRECT_FULL_SIZE) retainDownload(target)
                val result = repository.requestTheme(target.kitsuId, target.themeId, reason)
                _state.value = ThemeMusicRequestUiState(target, reason, busy = false, result = result)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                _state.value = ThemeMusicRequestUiState(target, reason, busy = false, error = requestError(error))
            }
        }
    }

    fun refresh() {
        val current = _state.value ?: return
        val result = current.result ?: return
        if (current.busy) return
        _state.value = current.copy(busy = true, error = null)
        scope.launch {
            try {
                val updated = repository.get(result.request.id)
                _state.value = current.copy(result = result.copy(request = updated), error = null)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                _state.value = current.copy(error = "Could not refresh status. Your request is still saved; try again.")
            }
        }
    }

    fun retry() {
        val current = _state.value ?: return
        if (current.result != null) refresh() else submit(current.target, current.reason)
    }
}

private fun requestError(error: Exception): String = when ((error as? HttpException)?.code()) {
    401, 403 -> "Sign in to request or report a song."
    404 -> "This song request is unavailable. The server may need an update."
    409 -> "Another request may be active, or this theme cannot be requested yet. Check the anime’s music request status and try again."
    else -> "Could not confirm the song request. Check your connection and try again."
}
