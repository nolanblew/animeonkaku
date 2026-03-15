package com.takeya.animeongaku.media

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.ThemeEntity
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for the MediaController connection and queue synchronization.
 *
 * Bridges NowPlayingManager (queue state) ↔ MediaController (actual playback).
 * Exposes [playbackState] for UI to observe playback position, buffering, errors, etc.
 * All queue changes flow through NowPlayingManager → this class → MediaController.
 */
@Singleton
class MediaControllerManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val nowPlayingManager: NowPlayingManager,
    private val playCountDao: PlayCountDao,
    private val nowPlayingPersistence: NowPlayingPersistence
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var controller: MediaController? = null
    private var lastSyncedVersion: Long = -1L
    
    // Store restored state that should be applied once controller connects
    private var pendingRestoreState: Pair<RestoredQueueState, Boolean>? = null

    private val _playbackState = MutableStateFlow(PlaybackState())
    val playbackState: StateFlow<PlaybackState> = _playbackState.asStateFlow()

    private val _controllerReady = MutableStateFlow(false)

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _playbackState.value = _playbackState.value.copy(isPlaying = isPlaying)
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            _playbackState.value = _playbackState.value.copy(
                isBuffering = playbackState == Player.STATE_BUFFERING,
                errorMessage = if (playbackState == Player.STATE_IDLE &&
                    _playbackState.value.errorMessage != null
                ) _playbackState.value.errorMessage else null
            )
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val ctrl = controller ?: return
            val idx = ctrl.currentMediaItemIndex
            nowPlayingManager.onTrackChanged(idx)
            _playbackState.value = _playbackState.value.copy(errorMessage = null)

            // Record play count on track start
            val themeId = mediaItem?.mediaId?.toLongOrNull()
            if (themeId != null) {
                scope.launch { playCountDao.incrementPlayCount(themeId) }
            }
        }

        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
            _playbackState.value = _playbackState.value.copy(
                errorMessage = "Playback error: ${error.localizedMessage ?: "Unknown error"}",
                isBuffering = false
            )
        }
    }

    init {
        connectController()
        startQueueSync()
        startPositionPolling()
        startStatePersistence()
    }

    private fun connectController() {
        val sessionToken = SessionToken(
            context,
            ComponentName(context, MediaPlaybackService::class.java)
        )
        val future = MediaController.Builder(context, sessionToken).buildAsync()
        future.addListener(
            {
                val ctrl = future.get()
                controller = ctrl
                ctrl.addListener(playerListener)
                _controllerReady.value = true

                // Read initial state from controller
                updatePlaybackPositionFromController(ctrl)
                
                // If we had a pending restore, apply it now
                pendingRestoreState?.let { (state, autoPlay) ->
                    pendingRestoreState = null
                    restoreFromPersistedState(state, ctrl, autoPlay)
                }
            },
            androidx.core.content.ContextCompat.getMainExecutor(context)
        )
    }

    private fun startQueueSync() {
        scope.launch {
            // Wait for controller to be ready before syncing
            _controllerReady.collectLatest { ready ->
                if (!ready) return@collectLatest
                // Once ready, observe queue changes
                nowPlayingManager.state
                    .distinctUntilChangedBy { it.queueVersion }
                    .collectLatest { npState ->
                        val ctrl = controller ?: return@collectLatest
                        syncQueueToController(ctrl, npState)
                    }
            }
        }
    }

    private fun startStatePersistence() {
        scope.launch {
            // Debounce state changes by 500ms before persisting
            @OptIn(kotlinx.coroutines.FlowPreview::class)
            nowPlayingManager.state
                .debounce(500L)
                .collectLatest { state ->
                    // Only save if there's actually a queue
                    if (state.nowPlaying.isNotEmpty()) {
                        val pos = controller?.currentPosition ?: _playbackState.value.positionMs
                        val rep = controller?.repeatMode ?: Player.REPEAT_MODE_OFF
                        nowPlayingPersistence.save(state, pos, rep)
                    } else {
                        nowPlayingPersistence.clear()
                    }
                }
        }
    }

    /**
     * Called to immediately load a persisted state into the controller.
     * Can be called before or after the controller is connected.
     */
    fun restore(restoredState: RestoredQueueState, autoPlay: Boolean = false) {
        // We set autoPlay inside NowPlayingManager so we know later when syncing
        // if we should play. Alternatively, we just set a flag here.
        // Actually, NowPlayingManager doesn't track autoPlay. We'll set the queue in NowPlayingManager,
        // and if controller is ready, sync it immediately.
        
        nowPlayingManager.restoreState(restoredState.nowPlayingState)
        
        val ctrl = controller
        if (ctrl == null) {
            // Wait for connect
            pendingRestoreState = Pair(restoredState, autoPlay)
        } else {
            restoreFromPersistedState(restoredState, ctrl, autoPlay)
        }
    }

    private fun restoreFromPersistedState(restoredState: RestoredQueueState, ctrl: MediaController, autoPlay: Boolean = false) {
        val npState = restoredState.nowPlayingState
        val items = npState.nowPlaying.map { it.toMediaItem(npState.animeMap) }
        
        ctrl.setMediaItems(items, npState.currentIndex, restoredState.positionMs)
        ctrl.repeatMode = restoredState.repeatMode
        ctrl.playWhenReady = autoPlay
        ctrl.prepare()
        
        lastSyncedVersion = npState.queueVersion
    }

    private fun syncQueueToController(ctrl: MediaController, npState: NowPlayingState) {
        if (npState.nowPlaying.isEmpty()) {
            ctrl.clearMediaItems()
            ctrl.stop()
            lastSyncedVersion = npState.queueVersion
            return
        }

        if (lastSyncedVersion == npState.queueVersion) return

        if (npState.isFullReload) {
            // Check if the controller is already playing the correct track
            val controllerMediaId = ctrl.currentMediaItem?.mediaId
            val expectedMediaId = npState.currentTheme?.id?.toString()

            if (controllerMediaId != null && controllerMediaId == expectedMediaId) {
                // Controller already has the right song — just sync surrounding queue
                syncQueueAroundCurrent(ctrl, npState)
            } else {
                // Full replacement
                val items = npState.nowPlaying.map { it.toMediaItem(npState.animeMap) }
                ctrl.setMediaItems(items, npState.currentIndex, C.TIME_UNSET)
                ctrl.playWhenReady = true
                ctrl.prepare()
            }
        } else {
            // Queue mutation (playNext, addToQueue, shuffle) — sync without interrupting
            syncQueueAroundCurrent(ctrl, npState)
        }

        lastSyncedVersion = npState.queueVersion
    }

    private fun syncQueueAroundCurrent(ctrl: MediaController, npState: NowPlayingState) {
        val controllerCount = ctrl.mediaItemCount
        val currentMediaIdx = ctrl.currentMediaItemIndex

        // Remove all items after current
        if (controllerCount > currentMediaIdx + 1) {
            ctrl.removeMediaItems(currentMediaIdx + 1, controllerCount)
        }
        // Remove all items before current
        if (currentMediaIdx > 0) {
            ctrl.removeMediaItems(0, currentMediaIdx)
        }
        // Now controller has only the current item at index 0.

        // Add items before current
        val beforeItems = npState.nowPlaying.subList(0, npState.currentIndex)
            .map { it.toMediaItem(npState.animeMap) }
        for ((i, item) in beforeItems.withIndex()) {
            ctrl.addMediaItem(i, item)
        }

        // Add items after current
        if (npState.currentIndex + 1 < npState.nowPlaying.size) {
            val afterItems = npState.nowPlaying
                .subList(npState.currentIndex + 1, npState.nowPlaying.size)
                .map { it.toMediaItem(npState.animeMap) }
            for (item in afterItems) {
                ctrl.addMediaItem(item)
            }
        }
    }

    private fun startPositionPolling() {
        scope.launch {
            while (isActive) {
                controller?.let { ctrl ->
                    if (ctrl.mediaItemCount > 0) {
                        val duration = ctrl.duration.takeIf { it > 0 } ?: _playbackState.value.durationMs
                        _playbackState.value = _playbackState.value.copy(
                            positionMs = ctrl.currentPosition,
                            durationMs = duration,
                            bufferedPositionMs = ctrl.bufferedPosition,
                            isPlaying = ctrl.isPlaying,
                            hasMedia = true
                        )
                    } else {
                        _playbackState.value = _playbackState.value.copy(hasMedia = false)
                    }
                }
                delay(100)
            }
        }
    }

    private fun updatePlaybackPositionFromController(ctrl: MediaController) {
        val duration = ctrl.duration.takeIf { it > 0 } ?: 1L
        _playbackState.value = PlaybackState(
            isPlaying = ctrl.isPlaying,
            positionMs = ctrl.currentPosition,
            durationMs = duration,
            bufferedPositionMs = ctrl.bufferedPosition,
            isBuffering = ctrl.playbackState == Player.STATE_BUFFERING,
            hasMedia = ctrl.mediaItemCount > 0
        )
    }

    // --- Playback controls (delegate to MediaController) ---

    fun play() { controller?.play() }
    fun pause() { controller?.pause() }
    fun seekTo(positionMs: Long) { controller?.seekTo(positionMs) }
    fun seekToNext() { controller?.seekToNext() }
    fun seekToPrevious() { controller?.seekToPrevious() }

    fun seekBackTenSeconds() {
        controller?.let { ctrl ->
            val newPosition = (ctrl.currentPosition - 10_000).coerceAtLeast(0L)
            ctrl.seekTo(newPosition)
        }
    }

    fun toggleRepeatMode() {
        controller?.let { ctrl ->
            ctrl.repeatMode = when (ctrl.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
            _playbackState.value = _playbackState.value.copy(repeatMode = ctrl.repeatMode)
        }
    }

    val repeatMode: Int
        get() = controller?.repeatMode ?: Player.REPEAT_MODE_OFF
}

data class PlaybackState(
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 1L,
    val bufferedPositionMs: Long = 0L,
    val isBuffering: Boolean = false,
    val hasMedia: Boolean = false,
    val errorMessage: String? = null,
    val repeatMode: Int = Player.REPEAT_MODE_OFF
)

private fun ThemeEntity.toMediaItem(animeMap: Map<Long, AnimeEntity>): MediaItem {
    val anime = animeId?.let { animeMap[it] }
    val artworkUrl = anime?.coverUrl ?: anime?.thumbnailUrl
    val animeName = anime?.title
    val typeTag = themeType

    val primaryLine = when {
        !animeName.isNullOrBlank() && !typeTag.isNullOrBlank() -> "$animeName · $typeTag"
        !animeName.isNullOrBlank() -> animeName
        !typeTag.isNullOrBlank() -> "$typeTag · $title"
        else -> title
    }
    val secondaryLine = when {
        !artistName.isNullOrBlank() -> "$title · $artistName"
        else -> title
    }

    return MediaItem.Builder()
        .setMediaId(id.toString())
        .setUri(audioUrl)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(primaryLine)
                .setArtist(secondaryLine)
                .setAlbumTitle(animeName)
                .apply {
                    if (!artworkUrl.isNullOrBlank()) {
                        setArtworkUri(Uri.parse(artworkUrl))
                    }
                }
                .build()
        )
        .build()
}
