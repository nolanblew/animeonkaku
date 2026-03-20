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
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.network.ConnectivityMonitor
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
    private val userPreferencesRepository: UserPreferencesRepository,
    private val nowPlayingPersistence: NowPlayingPersistence,
    private val connectivityMonitor: ConnectivityMonitor
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var controller: MediaController? = null
    private var lastSyncedVersion: Long = -1L
    
    // Store restored state that should be applied once controller connects
    private var pendingRestoreState: Pair<RestoredQueueState, Boolean>? = null

    private val _playbackState = MutableStateFlow(PlaybackState())
    val playbackState: StateFlow<PlaybackState> = _playbackState.asStateFlow()

    private val _controllerReady = MutableStateFlow(false)

    private var consecutiveErrors = 0
    private val MAX_CONSECUTIVE_ERRORS = 5

    private var cachedDislikedThemeIds: Set<Long> = emptySet()

    private fun shouldIncludeInPlayer(idx: Int, theme: ThemeEntity, npState: NowPlayingState): Boolean {
        if (idx == npState.currentIndex) return true
        if (npState.unskippedIndices.contains(idx)) return true
        return !cachedDislikedThemeIds.contains(theme.id)
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            _playbackState.value = _playbackState.value.copy(isPlaying = isPlaying)
            if (isPlaying) consecutiveErrors = 0
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
            _playbackState.value = _playbackState.value.copy(errorMessage = null)

            val themeId = mediaItem?.mediaId?.toLongOrNull()
            if (themeId != null) {
                // Determine true index in queue by original ID rather than current raw exo pos
                nowPlayingManager.onTrackChangedByThemeId(themeId)
                
                // Record play count on track start
                scope.launch { playCountDao.incrementPlayCount(themeId) }
            }
        }

        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
            consecutiveErrors++
            val msg = if (!connectivityMonitor.isOnline.value) {
                "You're offline. Download songs to listen without internet."
            } else {
                "Playback error: ${error.localizedMessage ?: "Unknown error"}"
            }
            _playbackState.value = _playbackState.value.copy(
                errorMessage = msg,
                isBuffering = false
            )
            // Auto-skip to next track on any error (stop after too many consecutive)
            if (consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
                scope.launch {
                    delay(500)
                    try {
                        controller?.let { ctrl ->
                            if (ctrl.hasNextMediaItem()) {
                                ctrl.seekToNextMediaItem()
                                ctrl.prepare()
                                ctrl.play()
                            }
                        }
                    } catch (e: Exception) {
                        // Ignore — controller may be disconnected
                    }
                }
            }
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
                
                // Observe disliked tracking state locally to avoid async resolution timing bugs
                // Also proactively seek to next if the *currently* playing song gets disliked.
                scope.launch {
                    userPreferencesRepository.observeDislikedThemeIds().collectLatest { dislikedList ->
                        val newSet = dislikedList.toSet()
                        val oldSet = cachedDislikedThemeIds
                        cachedDislikedThemeIds = newSet

                        val ctrl = controller ?: return@collectLatest
                        val npState = nowPlayingManager.state.value
                        
                        // We must re-sync the queue around the current item in case upcoming skips changed
                        if (npState.nowPlaying.isNotEmpty()) {
                            syncQueueAroundCurrent(ctrl, npState)
                            
                            val currentTheme = npState.currentTheme
                            val isUnskipped = npState.unskippedIndices.contains(npState.currentIndex)
                            
                            // If the currently playing song just became disliked (and not unskipped), auto-skip it
                            if (currentTheme != null && newSet.contains(currentTheme.id) && !oldSet.contains(currentTheme.id) && !isUnskipped) {
                                if (ctrl.hasNextMediaItem()) {
                                    ctrl.seekToNext()
                                } else {
                                    ctrl.stop()
                                }
                            }
                        }
                    }
                }

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
        val mappedItems = npState.nowPlaying.mapIndexedNotNull { idx, theme ->
            if (shouldIncludeInPlayer(idx, theme, npState)) theme.toMediaItem(npState.animeMap) else null
        }
        
        var exoStartIndex = 0
        for (i in 0 until npState.currentIndex) {
            if (shouldIncludeInPlayer(i, npState.nowPlaying[i], npState)) exoStartIndex++
        }
        
        ctrl.setMediaItems(mappedItems, exoStartIndex, restoredState.positionMs)
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
                // Full replacement (find valid items only)
                val mappedItems = npState.nowPlaying.mapIndexedNotNull { idx, theme ->
                    if (shouldIncludeInPlayer(idx, theme, npState)) theme.toMediaItem(npState.animeMap) else null
                }
                var exoStartIndex = 0
                for (i in 0 until npState.currentIndex) {
                    if (shouldIncludeInPlayer(i, npState.nowPlaying[i], npState)) exoStartIndex++
                }
                
                ctrl.setMediaItems(mappedItems, exoStartIndex, C.TIME_UNSET)
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

        // Resolve the actual index in npState that matches the controller's current item
        val controllerMediaId = ctrl.currentMediaItem?.mediaId
        val centerIndex = if (controllerMediaId != null) {
            val currentThemeId = npState.currentTheme?.id?.toString()
            if (currentThemeId == controllerMediaId) {
                npState.currentIndex
            } else {
                // Out of sync (e.g. track just changed but npState not yet updated)
                // Search forward first
                var found = -1
                for (i in npState.currentIndex until npState.nowPlaying.size) {
                    if (npState.nowPlaying[i].id.toString() == controllerMediaId) {
                        found = i
                        break
                    }
                }
                // Then backward
                if (found == -1) {
                    for (i in npState.currentIndex - 1 downTo 0) {
                        if (npState.nowPlaying[i].id.toString() == controllerMediaId) {
                            found = i
                            break
                        }
                    }
                }
                if (found != -1) found else npState.currentIndex
            }
        } else {
            npState.currentIndex
        }

        // Add items before current
        val beforeItems = npState.nowPlaying.subList(0, centerIndex)
            .filterIndexed { idx, theme -> shouldIncludeInPlayer(idx, theme, npState) }
            .map { it.toMediaItem(npState.animeMap) }
        for ((i, item) in beforeItems.withIndex()) {
            ctrl.addMediaItem(i, item)
        }

        // Add items after current
        if (centerIndex + 1 < npState.nowPlaying.size) {
            val afterItems = npState.nowPlaying
                .subList(centerIndex + 1, npState.nowPlaying.size)
                .filterIndexed { offset, theme -> 
                    shouldIncludeInPlayer(centerIndex + 1 + offset, theme, npState) 
                }
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
    val artworkUrl = anime?.primaryArtworkUrl()
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

    // Prefer local file for downloaded songs
    val uri = if (isDownloaded && !localFilePath.isNullOrBlank()) {
        if (localFilePath.startsWith("/")) "file://$localFilePath" else localFilePath
    } else {
        audioUrl
    }

    return MediaItem.Builder()
        .setMediaId(id.toString())
        .setUri(uri)
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
