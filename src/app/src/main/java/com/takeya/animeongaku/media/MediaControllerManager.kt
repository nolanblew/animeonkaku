package com.takeya.animeongaku.media

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import coil.ImageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrl
import com.takeya.animeongaku.data.local.primaryArtworkUrls
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
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
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
    private var lastSyncedMediaIds: List<String> = emptyList()
    
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
            controller ?: return
            _playbackState.value = _playbackState.value.copy(errorMessage = null)

            val queueEntryId = mediaItem?.mediaId?.toLongOrNull()
            if (queueEntryId != null) {
                val themeId = nowPlayingManager.state.value.nowPlayingEntries
                    .firstOrNull { it.queueId == queueEntryId }
                    ?.theme
                    ?.id

                nowPlayingManager.onTrackChangedByQueueId(queueEntryId)
                
                // Record play count on track start
                if (themeId != null) {
                    scope.launch { playCountDao.incrementPlayCount(themeId) }
                }
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
        startArtworkInjection()
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
                            forceSyncQueue(ctrl, npState)
                            
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

    /**
     * Watches the current track and injects a pre-cropped square bitmap into the media session
     * so Bluetooth receivers (e.g. Tesla) get a correctly-proportioned cover image.
     */
    private fun startArtworkInjection() {
        val imageLoader = ImageLoader(context)
        scope.launch {
            _controllerReady.collectLatest { ready ->
                if (!ready) return@collectLatest
                nowPlayingManager.state
                    .distinctUntilChangedBy { it.currentEntry?.queueId to it.currentTheme?.animeId }
                    .collectLatest { npState ->
                        val ctrl = controller ?: return@collectLatest
                        val currentEntry = npState.currentEntry ?: return@collectLatest
                        val theme = npState.currentTheme ?: return@collectLatest
                        val expectedQueueId = currentEntry.queueId.toString()
                        val anime = theme.animeId?.let { npState.animeMap[it] } ?: return@collectLatest
                        val urls = anime.primaryArtworkUrls()
                        if (urls.isEmpty()) return@collectLatest

                        val bitmap = loadSquareBitmap(imageLoader, urls) ?: return@collectLatest

                        // Verify the controller is still playing the same track after the async load
                        val currentIdx = ctrl.currentMediaItemIndex
                        if (currentIdx < 0 || currentIdx >= ctrl.mediaItemCount) return@collectLatest
                        val current = ctrl.getMediaItemAt(currentIdx)
                        if (current.mediaId != expectedQueueId) return@collectLatest

                        val bytes = withContext(Dispatchers.IO) {
                            ByteArrayOutputStream().use { bos ->
                                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, bos)
                                bos.toByteArray()
                            }
                        }

                        // Re-check after compression in case track changed again
                        val finalIdx = ctrl.currentMediaItemIndex
                        if (finalIdx < 0 || finalIdx >= ctrl.mediaItemCount) return@collectLatest
                        val finalItem = ctrl.getMediaItemAt(finalIdx)
                        if (finalItem.mediaId != expectedQueueId) return@collectLatest

                        val updatedMetadata = finalItem.mediaMetadata.buildUpon()
                            .setArtworkData(bytes, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                            .build()
                        val updated = finalItem.buildUpon().setMediaMetadata(updatedMetadata).build()
                        ctrl.replaceMediaItem(finalIdx, updated)
                    }
            }
        }
    }

    private suspend fun loadSquareBitmap(imageLoader: ImageLoader, urls: List<String>): Bitmap? {
        for (url in urls) {
            val result = withContext(Dispatchers.IO) {
                imageLoader.execute(
                    ImageRequest.Builder(context)
                        .data(url)
                        .allowHardware(false)
                        .build()
                )
            }
            if (result is SuccessResult) {
                val raw = (result.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap
                    ?: continue
                return cropToSquare(raw)
            }
        }
        return null
    }

    private fun cropToSquare(src: Bitmap): Bitmap {
        val size = minOf(src.width, src.height)
        val x = (src.width - size) / 2
        val y = (src.height - size) / 2
        if (x == 0 && y == 0 && src.width == src.height) return src
        val dst = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(dst)
        val srcRect = Rect(x, y, x + size, y + size)
        val dstRect = Rect(0, 0, size, size)
        canvas.drawBitmap(src, srcRect, dstRect, Paint(Paint.FILTER_BITMAP_FLAG))
        return dst
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
        val (desiredItems, desiredCurrentIndex) = buildDesiredItems(npState)

        ctrl.setMediaItems(desiredItems, desiredCurrentIndex, restoredState.positionMs)
        ctrl.repeatMode = restoredState.repeatMode
        ctrl.playWhenReady = autoPlay
        ctrl.prepare()

        lastSyncedMediaIds = desiredItems.map { it.mediaId }
        lastSyncedVersion = npState.queueVersion
    }

    private fun syncQueueToController(ctrl: MediaController, npState: NowPlayingState) {
        if (lastSyncedVersion == npState.queueVersion) return
        forceSyncQueue(ctrl, npState)
    }

    /**
     * Applies the desired queue state to the controller using the minimal number of batched
     * Media3 calls. Bypasses the [lastSyncedVersion] fast-path so callers such as the disliked-
     * tracks observer (which mutates the filter without bumping [NowPlayingState.queueVersion])
     * still converge.
     */
    private fun forceSyncQueue(ctrl: MediaController, npState: NowPlayingState) {
        if (npState.nowPlaying.isEmpty()) {
            ctrl.clearMediaItems()
            ctrl.stop()
            lastSyncedMediaIds = emptyList()
            lastSyncedVersion = npState.queueVersion
            return
        }

        val (desiredItems, desiredCurrentIndex) = buildDesiredItems(npState)
        val desiredIds = desiredItems.map { it.mediaId }

        val controllerCurrentId = ctrl.currentMediaItem?.mediaId
        val expectedCurrentId = desiredItems.getOrNull(desiredCurrentIndex)?.mediaId

        if (controllerCurrentId == null || controllerCurrentId != expectedCurrentId) {
            // Current track needs to change (play new context, skipTo, rewindTo, fresh connect).
            // One batched IPC replaces the whole queue and seeks to the new current track.
            ctrl.setMediaItems(desiredItems, desiredCurrentIndex, C.TIME_UNSET)
            ctrl.playWhenReady = true
            ctrl.prepare()
        } else {
            // Current track is unchanged — apply a minimal diff so the session metadata and
            // Bluetooth receivers don't see unnecessary churn.
            applyDiffOps(ctrl, desiredItems, desiredIds)
        }

        lastSyncedMediaIds = desiredIds
        lastSyncedVersion = npState.queueVersion
    }

    /**
     * Build the list of [MediaItem]s the controller should hold for [npState], honoring the
     * dislike/unskip filter, and the desired current index within that filtered list.
     */
    private fun buildDesiredItems(npState: NowPlayingState): Pair<List<MediaItem>, Int> {
        val items = ArrayList<MediaItem>(npState.nowPlayingEntries.size)
        var currentIndex = 0
        npState.nowPlayingEntries.forEachIndexed { idx, entry ->
            if (shouldIncludeInPlayer(idx, entry.theme, npState)) {
                if (idx < npState.currentIndex) currentIndex++
                items.add(entry.toMediaItem(npState.animeMap))
            }
        }
        return items to currentIndex.coerceAtMost((items.size - 1).coerceAtLeast(0))
    }

    private fun applyDiffOps(ctrl: MediaController, desiredItems: List<MediaItem>, desiredIds: List<String>) {
        val ops = computeQueueOps(lastSyncedMediaIds, desiredIds)
        if (ops.isEmpty()) return

        val itemsById = desiredItems.associateBy { it.mediaId }
        for (op in ops) {
            when (op) {
                is QueueOp.Add -> {
                    val items = op.mediaIds.mapNotNull { itemsById[it] }
                    if (items.isNotEmpty()) ctrl.addMediaItems(op.position, items)
                }
                is QueueOp.Remove -> ctrl.removeMediaItems(op.fromIndex, op.toIndex)
                is QueueOp.Move -> ctrl.moveMediaItem(op.fromIndex, op.toIndex)
                is QueueOp.Replace -> itemsById[op.mediaId]?.let { ctrl.replaceMediaItem(op.position, it) }
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

private fun QueueEntry.toMediaItem(animeMap: Map<Long, AnimeEntity>): MediaItem =
    theme.toMediaItem(queueId.toString(), animeMap)

private fun ThemeEntity.toMediaItem(mediaId: String, animeMap: Map<Long, AnimeEntity>): MediaItem {
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
        .setMediaId(mediaId)
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
