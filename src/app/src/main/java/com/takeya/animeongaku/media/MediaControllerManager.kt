package com.takeya.animeongaku.media

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.takeya.animeongaku.data.local.AppDatabase
import coil.ImageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.PendingPlayDao
import com.takeya.animeongaku.data.local.PendingPlayEntity
import com.takeya.animeongaku.data.local.primaryArtworkUrls
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.repository.UserPreferencesRepository
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.network.ConnectivityMonitor
import com.takeya.animeongaku.network.ServerReachabilityMonitor
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

private fun PlaybackMode.fallbackLabel(): String = when (this) {
    PlaybackMode.TV_SIZE -> "TV Size"
    PlaybackMode.FULL_SIZE -> "Full Size"
    PlaybackMode.VIDEO -> "Video"
    PlaybackMode.RELATED_AUDIO -> "Related Audio"
}

private data class SyncedQueueStructure(
    val queueEntryIds: List<Long>,
    val currentQueueId: Long?,
    val playbackIntent: PlaybackIntent,
    val modeSelectionGeneration: Long
)

/**
 * Single source of truth for the MediaController connection and queue synchronization.
 *
 * Bridges NowPlayingManager (queue state) ↔ MediaController (actual playback).
 * Exposes [playbackState] for UI to observe playback position, buffering, errors, etc.
 * All queue changes flow through NowPlayingManager → this class → MediaController.
 */
@Singleton
@androidx.annotation.OptIn(UnstableApi::class)
class MediaControllerManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val nowPlayingManager: NowPlayingManager,
    private val playCountDao: PlayCountDao,
    private val pendingPlayDao: PendingPlayDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    private val nowPlayingPersistence: NowPlayingPersistence,
    private val connectivityMonitor: ConnectivityMonitor,
    private val serverReachabilityMonitor: ServerReachabilityMonitor,
    private val serverSettingsStore: ServerSettingsStore,
    private val imageLoader: ImageLoader,
    private val playbackResolutionCoordinator: PlaybackResolutionCoordinator,
    private val playbackPreferences: PlaybackPreferences,
    private val database: AppDatabase
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val artworkDataCache = ArtworkDataCache()

    private var controller: MediaController? = null
    private var lastSyncedVersion: Long = -1L
    private var lastSyncedMediaIds: List<String> = emptyList()
    private var lastSyncedDescriptors: List<PlaybackMediaDescriptor> = emptyList()
    private var resolvedItemsByQueueId: Map<Long, ResolvedPlaybackItem> = emptyMap()
    private var lastSyncedQueueStructure: SyncedQueueStructure? = null
    private var resolutionRevision = 0L
    private var lastSyncedResolutionRevision = -1L
    private val latestQueueSync = LatestPlaybackQueueSync()
    private val videoFallbackAttempts = VideoFallbackAttemptRegistry()
    
    // Store restored state that should be applied once controller connects
    private var pendingRestoreState: Pair<RestoredQueueState, Boolean>? = null
    private var controllerConnectionAttempts = 0
    private var controllerReconnectJob: Job? = null
    private var queueSyncPlayRequested = false
    private var lastConsumedPlayRequestGeneration = 0L
    private val playbackStateDirty = AtomicBoolean(false)
    private val playbackStateRevision = AtomicLong(0L)
    private val persistenceRevision = MutableStateFlow(0L)
    private val positionPollingActive = MutableStateFlow(false)

    private val _playbackState = MutableStateFlow(PlaybackState())
    val playbackState: StateFlow<PlaybackState> = _playbackState.asStateFlow()

    private val _mediaController = MutableStateFlow<MediaController?>(null)
    val mediaController: StateFlow<MediaController?> = _mediaController.asStateFlow()

    private val _controllerReady = MutableStateFlow(false)

    private val _controllerConnectionState = MutableStateFlow(MediaControllerConnectionState())
    val controllerConnectionState: StateFlow<MediaControllerConnectionState> =
        _controllerConnectionState.asStateFlow()

    private var consecutiveErrors = 0
    private val MAX_CONSECUTIVE_ERRORS = 5

    private var cachedThemePreferences: Map<Long, UserPreferenceEntity> = emptyMap()
    private var cachedDislikedSongIds: Set<Long> = emptySet()
    /** Guards duplicate preference/invalidation emissions before Media3 reports the transition. */
    private var pendingPreferenceSkipQueueId: Long? = null
    private val artworkPreloadAheadCount = 3

    /**
     * Queue state and controller-only state (seek, pause, repeat) share one debounced persistence
     * signal. The monotonic revision prevents an older I/O completion from clearing a newer change.
     */
    private fun markPlaybackStateDirty() {
        playbackStateDirty.set(true)
        val revision = playbackStateRevision.incrementAndGet()
        persistenceRevision.update { current -> maxOf(current, revision) }
    }

    private fun shouldIncludeInPlayer(idx: Int, entry: QueueEntry, npState: NowPlayingState): Boolean {
        if (idx == npState.currentIndex) return true
        if (npState.nowPlayingEntries.getOrNull(idx)?.queueId in npState.unskippedEntryIds) return true
        return when (val item = entry.item) {
            is PlayableItem.Theme -> cachedThemePreferences[item.theme.id]?.isDisliked != true
            is PlayableItem.RelatedSong -> item.song.id !in cachedDislikedSongIds
        }
    }

    private fun isAllowedByPreference(entry: QueueEntry, actualMode: PlaybackMode?): Boolean {
        return isQueueEntryAllowedByPreference(
            entry = entry,
            actualMode = actualMode,
            themePreferences = cachedThemePreferences,
            dislikedSongIds = cachedDislikedSongIds,
            unskippedEntryIds = nowPlayingManager.state.value.unskippedEntryIds
        )
    }

    private val playerListener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            markPlaybackStateDirty()
            _playbackState.value = _playbackState.value.copy(isPlaying = isPlaying)
            positionPollingActive.value = isPlaying
            controller?.let(::updatePlaybackPositionFromController)
            if (isPlaying) consecutiveErrors = 0
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            _playbackState.value = _playbackState.value.copy(
                isBuffering = playbackState == Player.STATE_BUFFERING,
                errorMessage = if (playbackState == Player.STATE_IDLE &&
                    _playbackState.value.errorMessage != null
                ) _playbackState.value.errorMessage else null
            )
            if (playbackState == Player.STATE_ENDED &&
                controller?.repeatMode == Player.REPEAT_MODE_OFF &&
                controller?.hasNextMediaItem() != true
            ) {
                nowPlayingManager.resetQueueModeAfterExhaustion()
            }
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            controller ?: return
            markPlaybackStateDirty()
            val queueEntryId = mediaItem?.mediaId?.toLongOrNull()
            updatePlaybackModeState(queueEntryId, resolvedItemsByQueueId[queueEntryId])
            if (queueEntryId != null) {
                val managerStateBeforeTransition = nowPlayingManager.state.value
                val targetBeforeTransition = managerStateBeforeTransition.nowPlayingEntries
                    .firstOrNull { it.queueId == queueEntryId }
                val shouldReplay = (
                    managerStateBeforeTransition.currentEntry?.queueId != queueEntryId &&
                        targetBeforeTransition?.lastActualMode != null
                    ) ||
                    reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
                if (shouldReplay) {
                    nowPlayingManager.onTrackChangedByQueueId(queueEntryId, replayRecordedMode = true)
                    val winningActualMode = resolvedItemsByQueueId[queueEntryId]?.actualMode
                    if (winningActualMode != null && winningActualMode != targetBeforeTransition?.lastActualMode) {
                        // The recorded source can disappear between plays. The descriptor already
                        // contains the resolver's allowed fallback, so persist what really won
                        // without clearing the replay pin or changing queue intent.
                        nowPlayingManager.recordActualMode(queueEntryId, winningActualMode)
                    }
                } else {
                    nowPlayingManager.recordActualMode(
                        queueEntryId,
                        resolvedItemsByQueueId[queueEntryId]?.actualMode
                    )
                    nowPlayingManager.onTrackChangedByQueueId(queueEntryId)
                }
                val entry = nowPlayingManager.state.value.nowPlayingEntries
                    .firstOrNull { it.queueId == queueEntryId }
                
                // Record play count on track start
                entry?.let { queueEntry ->
                    scope.launch { recordPlay(queueEntry, resolvedItemsByQueueId[queueEntryId]) }
                }
            }
        }

        override fun onRepeatModeChanged(repeatMode: Int) {
            markPlaybackStateDirty()
            _playbackState.value = _playbackState.value.copy(repeatMode = repeatMode)
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            markPlaybackStateDirty()
            controller?.let(::updatePlaybackPositionFromController)
        }

        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
            scope.launch { handlePlayerError(error) }
        }
    }

    private suspend fun handlePlayerError(error: androidx.media3.common.PlaybackException) {
        consecutiveErrors++
        val ctrl = controller ?: return
        if (tryVideoFallback(ctrl)) return

        val msg = if (!connectivityMonitor.isOnline.value) {
            "You're offline. Download songs to listen without internet."
        } else {
            "Playback error: ${error.localizedMessage ?: "Unknown error"}"
        }
        _playbackState.value = _playbackState.value.copy(
            errorMessage = msg,
            isBuffering = false
        )
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return

        delay(500)
        try {
            if (ctrl.hasNextMediaItem()) {
                ctrl.seekToNextMediaItem()
                ctrl.prepare()
                ctrl.play()
            }
        } catch (_: Exception) {
            // Controller may have disconnected while the finite retry was pending.
        }
    }

    private suspend fun tryVideoFallback(ctrl: MediaController): Boolean {
        val queueId = ctrl.currentMediaItem?.mediaId?.toLongOrNull() ?: return false
        val current = resolvedItemsByQueueId[queueId] ?: return false
        if (current.actualMode != PlaybackMode.VIDEO) return false

        val state = nowPlayingManager.state.value
        val entry = state.nowPlayingEntries.firstOrNull { it.queueId == queueId } ?: return false
        val captured = videoFallbackSnapshot(ctrl, state) ?: return false
        if (!videoFallbackAttempts.tryStart(queueId)) return true

        return try {
            val fallback = resolveForCurrentPlaybackSnapshot(
                captured = captured,
                currentSnapshot = { videoFallbackSnapshot(ctrl, nowPlayingManager.state.value) }
            ) {
                playbackResolutionCoordinator.resolveVideoFailureFallback(
                    entry,
                    state.playbackIntent
                )
            } ?: return true
            val fallbackActualMode = fallback.actualMode
            if (!fallback.isPlayable || fallbackActualMode == null || fallbackActualMode == PlaybackMode.VIDEO) {
                return false
            }

            val index = (0 until ctrl.mediaItemCount).firstOrNull { idx ->
                ctrl.getMediaItemAt(idx).mediaId == queueId.toString()
            } ?: return false
            val wasPlayWhenReady = ctrl.playWhenReady
            val artwork = entry.item.anime?.let(::cachedArtworkDataForAnime)
            ctrl.replaceMediaItem(
                index,
                fallback.toPlaybackMediaItem(
                    artworkData = artwork,
                    activeServerBaseUrl = serverSettingsStore.serverBaseUrl,
                    bluetoothMetadataStyle = playbackPreferences.bluetoothMetadataStyle
                )
            )
            ctrl.seekTo(index, 0L)
            ctrl.playWhenReady = wasPlayWhenReady
            ctrl.prepare()

            resolvedItemsByQueueId = resolvedItemsByQueueId + (queueId to fallback)
            // Replacing a Media3 item with the same queue id does not necessarily emit a
            // transition. Persist the actual fallback mode explicitly so Back/repeat and a
            // process restart retain the source that really played.
            nowPlayingManager.recordActualMode(queueId, fallbackActualMode)
            lastSyncedDescriptors = lastSyncedDescriptors.map { descriptor ->
                if (descriptor.mediaId == queueId.toString()) {
                    fallback.toPlaybackMediaDescriptor(
                        serverSettingsStore.serverBaseUrl,
                        playbackPreferences.bluetoothMetadataStyle
                    )
                } else descriptor
            }
            _playbackState.value = _playbackState.value.copy(
                errorMessage = "Video unavailable · playing ${fallbackActualMode.fallbackLabel()}",
                isBuffering = false,
                preferredMode = PlaybackMode.VIDEO,
                actualMode = fallbackActualMode,
                availableModes = fallback.availableModes,
                retainedIntentReason = fallback.retainedIntentReason,
                dislikedModes = fallback.dislikedModes,
                videoSpoiler = fallback.videoSpoiler,
                videoNsfw = fallback.videoNsfw
            )
            true
        } finally {
            videoFallbackAttempts.finish(queueId)
        }
    }

    private fun videoFallbackSnapshot(
        ctrl: MediaController,
        state: NowPlayingState
    ): VideoFallbackSnapshot? {
        val mediaItem = ctrl.currentMediaItem ?: return null
        return VideoFallbackSnapshot(
            queueVersion = state.queueVersion,
            intent = state.playbackIntent,
            currentMedia = PlaybackMediaFingerprint(
                mediaId = mediaItem.mediaId,
                uri = mediaItem.localConfiguration?.uri?.toString(),
                tag = mediaItem.localConfiguration?.tag as? PlaybackMediaTag
            )
        )
    }

    private suspend fun recordPlay(entry: QueueEntry, resolved: ResolvedPlaybackItem?) {
        val playedAt = System.currentTimeMillis()
        val item = entry.item
        val themeId = entry.themeOrNull?.id
        if (themeId != null) playCountDao.incrementPlayCount(themeId, playedAt)
        if (serverSettingsStore.isConfigured) {
            pendingPlayDao.insert(
                PendingPlayEntity(
                    // Kept as a legacy compatibility field only. Typed identity is authoritative.
                    themeId = themeId ?: item.key.id,
                    playedAt = playedAt,
                    clientEventId = UUID.randomUUID().toString(),
                    itemType = when (item) {
                        is PlayableItem.Theme -> "THEME"
                        is PlayableItem.RelatedSong -> "SONG"
                    },
                    itemId = item.key.id,
                    actualMode = when (resolved?.actualMode) {
                        PlaybackMode.RELATED_AUDIO -> "AUDIO"
                        null -> "TV_SIZE"
                        else -> resolved.actualMode.name
                    }
                )
            )
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
        val controllerListener = object : MediaController.Listener {
            override fun onDisconnected(disconnectedController: MediaController) {
                if (controller !== disconnectedController) return
                val resumeAfterReconnect = runCatching { disconnectedController.playWhenReady }
                    .getOrDefault(false)
                runCatching { disconnectedController.removeListener(playerListener) }
                controller = null
                _mediaController.value = null
                _controllerReady.value = false
                positionPollingActive.value = false
                lastSyncedVersion = -1L
                queueSyncPlayRequested = queueSyncPlayRequested || resumeAfterReconnect
                handleControllerConnectionFailure(
                    IllegalStateException("Playback service disconnected")
                )
            }
        }

        val future = MediaController.Builder(context, sessionToken)
            .setListener(controllerListener)
            .buildAsync()
        future.addListener(
            {
                try {
                    val ctrl = future.get()
                    controllerConnectionAttempts = 0
                    controllerReconnectJob = null
                    controller = ctrl
                    _mediaController.value = ctrl
                    ctrl.addListener(playerListener)
                    _controllerConnectionState.value = MediaControllerConnectionState(isReady = true)

                    // Do not publish readiness until a pending restore has populated Media3. This
                    // prevents the queue observer from racing the restore and losing its pause
                    // state or saved position.
                    val pendingRestore = pendingRestoreState
                    if (pendingRestore == null) {
                        _controllerReady.value = true
                        updatePlaybackPositionFromController(ctrl)
                        positionPollingActive.value = ctrl.isPlaying
                    } else {
                        pendingRestoreState = null
                        scope.launch {
                            try {
                                restoreFromPersistedState(pendingRestore.first, ctrl, pendingRestore.second)
                            } finally {
                                _controllerReady.value = true
                                updatePlaybackPositionFromController(ctrl)
                                positionPollingActive.value = ctrl.isPlaying
                            }
                        }
                    }
                } catch (error: Exception) {
                    handleControllerConnectionFailure(error)
                }
            },
            androidx.core.content.ContextCompat.getMainExecutor(context)
        )
    }

    private fun handleControllerConnectionFailure(error: Throwable) {
        _controllerReady.value = false
        val attempt = controllerConnectionAttempts++
        _controllerConnectionState.value = MediaControllerConnectionState(
            isReady = false,
            retryAttempt = attempt + 1,
            errorMessage = error.localizedMessage ?: "Unable to connect playback service"
        )
        controllerReconnectJob?.cancel()
        controllerReconnectJob = scope.launch {
            delay(controllerConnectionRetryDelayMs(failure = error, attempt = attempt))
            connectController()
        }
    }

    private fun startQueueSync() {
        scope.launch {
            _controllerReady.collectLatest { ready ->
                if (!ready) return@collectLatest
                coroutineScope {
                    // All collectors are scoped to readiness. A reconnect cancels this whole
                    // group before creating one new set, rather than accumulating observers.
                    launch {
                        var previousPreferences: Map<Long, UserPreferenceEntity> = emptyMap()
                        var hasPreferenceBaseline = false
                        userPreferencesRepository.observeAllPreferences().collectLatest { preferences ->
                            val nextPreferences = preferences.associateBy { it.themeId }
                            val previous = if (hasPreferenceBaseline) previousPreferences else nextPreferences
                            hasPreferenceBaseline = true
                            previousPreferences = nextPreferences
                            cachedThemePreferences = nextPreferences
                            resolutionRevision++
                            val ctrl = controller ?: return@collectLatest
                            val npState = nowPlayingManager.state.value
                            if (npState.nowPlayingEntries.isNotEmpty()) {
                                val current = npState.currentEntry
                                val currentResolved = current?.queueId?.let(resolvedItemsByQueueId::get)
                                val currentThemeId = current?.themeOrNull?.id
                                val savedModeChanged = hasPreferenceBaseline && currentThemeId != null &&
                                    previous[currentThemeId]?.preferredMode !=
                                    nextPreferences[currentThemeId]?.preferredMode
                                val newlyDisliked = current != null && currentResolved != null &&
                                    newlyDislikedThemeOccurrence(
                                        current,
                                        currentResolved.actualMode,
                                        previous[current.themeOrNull?.id],
                                        nextPreferences[current.themeOrNull?.id]
                                    )
                                val invalidateCurrentOccurrence = newlyDisliked || savedModeChanged
                                if (invalidateCurrentOccurrence && current != null) {
                                    nowPlayingManager.invalidateOccurrenceForPreference(current.queueId)
                                }
                                applyPreferenceQueueFilter(
                                    ctrl,
                                    nowPlayingManager.state.value,
                                    preserveCurrentPlayback = !invalidateCurrentOccurrence
                                )
                            }
                        }
                    }
                    launch {
                        var previousDislikedSongIds: Set<Long> = emptySet()
                        var hasDislikedSongBaseline = false
                        userPreferencesRepository.observeDislikedSongIds().collectLatest { dislikedSongIds ->
                            val nextDislikedSongIds = dislikedSongIds.toSet()
                            val newlyDislikedSongs = if (hasDislikedSongBaseline) {
                                nextDislikedSongIds - previousDislikedSongIds
                            } else {
                                emptySet()
                            }
                            hasDislikedSongBaseline = true
                            previousDislikedSongIds = nextDislikedSongIds
                            cachedDislikedSongIds = nextDislikedSongIds
                            resolutionRevision++
                            controller?.let { ctrl ->
                                val state = nowPlayingManager.state.value
                                if (state.nowPlayingEntries.isNotEmpty()) {
                                    val current = state.currentEntry
                                    val newlyDisliked = current?.item?.let { item ->
                                        item is PlayableItem.RelatedSong && item.song.id in newlyDislikedSongs
                                    } == true
                                    if (newlyDisliked) {
                                        current?.queueId?.let(nowPlayingManager::invalidateOccurrenceForPreference)
                                    }
                                    applyPreferenceQueueFilter(
                                        ctrl,
                                        nowPlayingManager.state.value,
                                        preserveCurrentPlayback = !newlyDisliked
                                    )
                                }
                            }
                        }
                    }
                    launch {
                        // Loudness arrives asynchronously after a cached/imported file is analyzed.
                        // Rebuild the active queue when the next library delta writes its profile,
                        // including a same-queue-id TV/Full replacement, without waiting for a
                        // user queue mutation or an app restart.
                        playbackAvailabilityChanges(
                            serverReachable = serverReachabilityMonitor.isReachable,
                            mediaInvalidations = database.invalidationTracker
                                .createFlow("theme_modes", "songs", "download_items")
                                .drop(1)
                                .map { Unit }
                        )
                                .collectLatest { change ->
                                    resolutionRevision++
                                if (change == PlaybackAvailabilityChange.ServerReachability(false)) {
                                    _playbackState.update(PlaybackState::withServerUnavailable)
                                }
                                val ctrl = controller ?: return@collectLatest
                                val npState = nowPlayingManager.state.value
                                if (npState.nowPlayingEntries.isNotEmpty()) {
                                    forceSyncQueue(ctrl, npState, preserveCurrentPlayback = true)
                                }
                            }
                    }
                    launch {
                        playbackPreferences.bluetoothMetadataStyleFlow.collectLatest {
                            resolutionRevision++
                            val ctrl = controller ?: return@collectLatest
                            val npState = nowPlayingManager.state.value
                            if (npState.nowPlayingEntries.isNotEmpty()) {
                                forceSyncQueue(ctrl, npState, preserveCurrentPlayback = true)
                            }
                        }
                    }
                    nowPlayingManager.state
                        .distinctUntilChangedBy { it.queueVersion }
                        .collectLatest { npState ->
                            val ctrl = controller ?: return@collectLatest
                            syncQueueToController(ctrl, npState)
                        }
                }
            }
        }
    }

    /**
     * Watches the current track and injects a pre-cropped square bitmap into the media session
     * so Bluetooth receivers (e.g. Tesla) get a correctly-proportioned cover image.
     */
    private fun startArtworkInjection() {
        scope.launch {
            _controllerReady.collectLatest { ready ->
                if (!ready) return@collectLatest
                nowPlayingManager.state
                    .distinctUntilChangedBy { state ->
                        state.currentEntry?.queueId to
                            state.upcomingEntries.take(artworkPreloadAheadCount).map { it.queueId }
                    }
                    .collectLatest { npState ->
                        val ctrl = controller ?: return@collectLatest
                        preloadArtworkForPlaybackWindow(ctrl, npState)
                    }
            }
        }
    }

    private suspend fun preloadArtworkForPlaybackWindow(ctrl: MediaController, npState: NowPlayingState) {
        val entries = buildList {
            npState.currentEntry?.let(::add)
            addAll(npState.upcomingEntries.take(artworkPreloadAheadCount))
        }
        if (entries.isEmpty()) return

        coroutineScope {
            entries.map { entry ->
                async {
                    injectArtworkForEntry(ctrl, entry, npState)
                }
            }.awaitAll()
        }
    }

    private suspend fun injectArtworkForEntry(
        ctrl: MediaController,
        entry: QueueEntry,
        npState: NowPlayingState
    ) {
        val anime = entry.item.anime
            ?: entry.themeOrNull?.animeId?.let { npState.animeMap[it] }
            ?: return
        val bytes = loadArtworkData(anime) ?: return
        replaceMediaItemArtworkData(ctrl, entry.queueId.toString(), bytes)
    }

    private suspend fun loadArtworkData(anime: AnimeEntity): ByteArray? {
        val urls = anime.primaryArtworkUrls()
        if (urls.isEmpty()) return null

        val cacheKey = artworkCacheKey(anime, urls)
        artworkDataCache.get(cacheKey)?.let { return it }

        val bitmap = loadSquareBitmap(imageLoader, urls) ?: return null
        val bytes = withContext(Dispatchers.IO) {
            ByteArrayOutputStream().use { bos ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 90, bos)
                bos.toByteArray()
            }
        }
        artworkDataCache.put(cacheKey, bytes)
        return bytes
    }

    private fun replaceMediaItemArtworkData(
        ctrl: MediaController,
        mediaId: String,
        artworkData: ByteArray
    ) {
        for (idx in 0 until ctrl.mediaItemCount) {
            val item = ctrl.getMediaItemAt(idx)
            if (item.mediaId != mediaId) continue

            val existingArtwork = item.mediaMetadata.artworkData
            if (existingArtwork != null && existingArtwork.contentEquals(artworkData)) return

            ctrl.replaceMediaItem(idx, item.withArtworkData(artworkData))
            return
        }
    }

    private suspend fun loadSquareBitmap(imageLoader: ImageLoader, urls: List<String>): Bitmap? {
        for (url in urls) {
            val cropped = withContext(Dispatchers.IO) {
                imageLoader.execute(
                    ImageRequest.Builder(context)
                        .data(url)
                        .size(512, 512)
                        .allowHardware(false)
                        .build()
                ).let { result ->
                    (result as? SuccessResult)?.drawable
                        ?.let { it as? android.graphics.drawable.BitmapDrawable }
                        ?.bitmap
                        ?.let(::cropToSquare)
                }
            }
            if (cropped != null) return cropped
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
            nowPlayingManager.state.collect {
                markPlaybackStateDirty()
            }
        }
        scope.launch {
            // Queue and controller-only changes both increment this revision. Capturing the
            // revision before I/O lets a newer seek/pause/repeat remain dirty until its own save.
            @OptIn(kotlinx.coroutines.FlowPreview::class)
            persistenceRevision
                .filter { it > 0L }
                .debounce(500L)
                .collect { revision ->
                    persistPlaybackState(revision)
                }
        }
    }

    private suspend fun persistPlaybackState(revision: Long) {
        val state = nowPlayingManager.state.value
        val positionMs = controller?.currentPosition ?: _playbackState.value.positionMs
        val repeatMode = controller?.repeatMode ?: Player.REPEAT_MODE_OFF
        persistPlaybackSnapshot(state, positionMs, repeatMode, revision)
    }

    private suspend fun persistPlaybackSnapshot(
        state: NowPlayingState,
        positionMs: Long,
        repeatMode: Int,
        revision: Long,
    ) {
        val persisted = if (state.nowPlayingEntries.isNotEmpty()) {
            nowPlayingPersistence.save(state, positionMs, repeatMode)
        } else {
            nowPlayingPersistence.clear()
        }
        if (shouldClearPlaybackDirtyAfterPersist(
                persisted = persisted,
                savedRevision = revision,
                latestRevision = playbackStateRevision.get(),
            )
        ) {
            playbackStateDirty.set(false)
        } else {
            playbackStateDirty.set(true)
        }
    }

    /**
     * Called to immediately load a persisted state into the controller.
     * Can be called before or after the controller is connected.
     */
    fun restore(restoredState: RestoredQueueState, autoPlay: Boolean = false) {
        // Suspend queue collection while restore owns Media3 so the generic structural sync does
        // not turn a deliberately paused restored queue into playback.
        _controllerReady.value = false
        nowPlayingManager.restoreState(restoredState.nowPlayingState)
        
        val ctrl = controller
        if (ctrl == null) {
            // Wait for connect
            pendingRestoreState = Pair(restoredState, autoPlay)
        } else {
            scope.launch {
                try {
                    restoreFromPersistedState(restoredState, ctrl, autoPlay)
                } finally {
                    _controllerReady.value = true
                    updatePlaybackPositionFromController(ctrl)
                    positionPollingActive.value = ctrl.isPlaying
                }
            }
        }
    }

    internal suspend fun prepareForSessionResumption(restoredState: RestoredQueueState): PlaybackMediaItems {
        val npState = restoredState.nowPlayingState
        nowPlayingManager.restoreState(npState)
        val desired = buildDesiredItems(nowPlayingManager.state.value)
            ?: run {
                clearSyncedQueueState(npState.queueVersion)
                return PlaybackMediaItems(emptyList(), 0)
            }

        lastSyncedMediaIds = desired.items.map { it.mediaId }
        lastSyncedDescriptors = desired.descriptors
        resolvedItemsByQueueId = desired.resolved.associateBy { it.queueId }
        lastSyncedVersion = npState.queueVersion
        lastConsumedPlayRequestGeneration = npState.playRequestGeneration
        rememberQueueStructure(npState)
        return PlaybackMediaItems(desired.items, desired.currentIndex)
    }

    internal suspend fun playbackItemsForSessionResumption(): PlaybackMediaItems {
        val npState = nowPlayingManager.state.value
        val desired = buildDesiredItems(npState)
            ?: run {
                clearSyncedQueueState(npState.queueVersion)
                return PlaybackMediaItems(emptyList(), 0)
            }
        lastSyncedMediaIds = desired.items.map { it.mediaId }
        lastSyncedDescriptors = desired.descriptors
        resolvedItemsByQueueId = desired.resolved.associateBy { it.queueId }
        lastSyncedVersion = npState.queueVersion
        lastConsumedPlayRequestGeneration = npState.playRequestGeneration
        rememberQueueStructure(npState)
        return PlaybackMediaItems(desired.items, desired.currentIndex)
    }

    private suspend fun restoreFromPersistedState(restoredState: RestoredQueueState, ctrl: MediaController, autoPlay: Boolean = false) {
        val npState = nowPlayingManager.state.value
        val desired = buildDesiredItems(npState)
        if (desired == null) {
            ctrl.clearMediaItems()
            ctrl.stop()
            clearSyncedQueueState(npState.queueVersion)
            return
        }

        resolvedItemsByQueueId = desired.resolved.associateBy { it.queueId }

        ctrl.setMediaItems(desired.items, desired.currentIndex, restoredState.positionMs)
        ctrl.repeatMode = restoredState.repeatMode
        ctrl.playWhenReady = autoPlay
        ctrl.prepare()

        lastSyncedMediaIds = desired.items.map { it.mediaId }
        lastSyncedDescriptors = desired.descriptors
        lastSyncedVersion = npState.queueVersion
        lastConsumedPlayRequestGeneration = npState.playRequestGeneration
        rememberQueueStructure(npState)
    }

    private suspend fun syncQueueToController(ctrl: MediaController, npState: NowPlayingState) {
        if (lastSyncedVersion == npState.queueVersion) return
        if (reuseResolvedItemsForStructuralMutation(ctrl, npState)) return
        forceSyncQueue(ctrl, npState)
    }

    /** Reorders/removes exact Media3 items without resolving or replacing the active source. */
    private fun reuseResolvedItemsForStructuralMutation(
        ctrl: MediaController,
        npState: NowPlayingState
    ): Boolean {
        val previous = lastSyncedQueueStructure ?: return false
        // A shuffle must not cancel an in-flight preference/availability refresh and
        // then mark its stale resolved items as current.
        if (lastSyncedResolutionRevision != resolutionRevision) return false
        val currentIds = ctrl.mediaIds()
        if (currentIds != lastSyncedMediaIds) return false

        val desiredIds = reusableResolvedQueueIdsForStructuralMutation(
            previousQueueEntryIds = previous.queueEntryIds,
            previousResolvedMediaIds = currentIds,
            previousCurrentQueueId = previous.currentQueueId,
            previousIntent = previous.playbackIntent,
            previousModeSelectionGeneration = previous.modeSelectionGeneration,
            nextQueueEntryIds = npState.nowPlayingEntries.map(QueueEntry::queueId),
            nextCurrentQueueId = npState.currentEntry?.queueId,
            nextIntent = npState.playbackIntent,
            nextModeSelectionGeneration = npState.modeSelectionGeneration
        ) ?: return false
        val currentMediaId = ctrl.currentMediaItem?.mediaId ?: return false
        val desiredCurrentIndex = desiredIds.indexOf(currentMediaId).takeIf { it >= 0 } ?: return false

        val currentItemsById = (0 until ctrl.mediaItemCount)
            .map(ctrl::getMediaItemAt)
            .associateBy(MediaItem::mediaId)
        val desiredItems = desiredIds.mapNotNull(currentItemsById::get)
        if (desiredItems.size != desiredIds.size) return false

        latestQueueSync.invalidate()
        applyDiffOps(ctrl, desiredItems, desiredIds, currentMediaId, desiredCurrentIndex)
        val descriptorsById = lastSyncedDescriptors.associateBy(PlaybackMediaDescriptor::mediaId)
        lastSyncedDescriptors = desiredIds.mapNotNull(descriptorsById::get)
        lastSyncedMediaIds = desiredIds
        resolvedItemsByQueueId = resolvedItemsByQueueId.filterKeys { it.toString() in desiredIds }
        lastSyncedVersion = npState.queueVersion
        rememberQueueStructure(npState)
        val currentQueueId = currentMediaId.toLongOrNull()
        updatePlaybackModeState(currentQueueId, currentQueueId?.let(resolvedItemsByQueueId::get))
        return true
    }

    /**
     * Applies the desired queue state to the controller using the minimal number of batched
     * Media3 calls. Bypasses the [lastSyncedVersion] fast-path so callers such as the disliked-
     * tracks observer (which mutates the filter without bumping [NowPlayingState.queueVersion])
     * still converge.
     */
    private suspend fun forceSyncQueue(
        ctrl: MediaController,
        npState: NowPlayingState,
        preserveCurrentPlayback: Boolean = false
    ): Boolean {
        // An explicit mode selection increments modeSelectionGeneration before the state
        // collector runs. A passive invalidation that was already queued must not win that race
        // and retain the old source; only preserve when the last committed queue has the same
        // explicit-selection generation.
        val appliedStructure = lastSyncedQueueStructure
        val sameAppliedPlaybackSelection = appliedStructure?.let {
            it.currentQueueId == npState.currentEntry?.queueId &&
                it.playbackIntent == npState.playbackIntent &&
                it.modeSelectionGeneration == npState.modeSelectionGeneration
        } == true
        val canPreserveCurrentPlayback = sameAppliedPlaybackSelection ||
            (preserveCurrentPlayback && appliedStructure == null)
        return latestQueueSync.runLatest(
            resolve = {
                if (npState.nowPlayingEntries.isEmpty()) {
                    null
                } else {
                    buildDesiredItems(
                        npState,
                        preserveCurrentPlayback = canPreserveCurrentPlayback
                    )
                }
            },
            // A Media3 transition can update queue state before its collector starts
            // the next resolution. Never let an old result rewind that transition.
            isCurrent = { nowPlayingManager.state.value.queueVersion == npState.queueVersion },
            commit = { desired ->
                commitQueueSync(
                    ctrl = ctrl,
                    npState = npState,
                    desired = desired,
                    preserveCurrentPlayback = canPreserveCurrentPlayback
                )
            }
        )
    }

    private fun commitQueueSync(
        ctrl: MediaController,
        npState: NowPlayingState,
        desired: DesiredPlaybackQueue?,
        preserveCurrentPlayback: Boolean = false
    ) {
        if (desired == null) {
            ctrl.clearMediaItems()
            ctrl.stop()
            clearSyncedQueueState(npState.queueVersion)
            return
        }

        // MediaItem tags are intentionally not a UI/state boundary: Media3 does not transport
        // arbitrary tags through MediaController/MediaSession bundle restoration. Publish the
        // resolver-owned metadata by stable queue occurrence identity before controller IPC.
        resolvedItemsByQueueId = desired.resolved.associateBy { it.queueId }

        val desiredItems = desired.items
        val desiredCurrentIndex = desired.currentIndex
        val desiredIds = desiredItems.map { it.mediaId }

        val controllerCurrentId = ctrl.currentMediaItem?.mediaId
        val expectedCurrentId = desiredItems.getOrNull(desiredCurrentIndex)?.mediaId
        val retainCurrent = preserveCurrentPlayback &&
            controllerCurrentId != null &&
            controllerCurrentId == expectedCurrentId
        val hasUnconsumedUserPlayRequest = hasUnconsumedPlayRequest(
            currentGeneration = npState.playRequestGeneration,
            consumedGeneration = lastConsumedPlayRequestGeneration,
        )

        if (controllerCurrentId == null || controllerCurrentId != expectedCurrentId) {
            // Current track needs to change (play new context, skipTo, rewindTo, fresh connect).
            // One batched IPC replaces the whole queue and seeks to the new current track.
            ctrl.setMediaItems(desiredItems, desiredCurrentIndex, C.TIME_UNSET)
            ctrl.playWhenReady = playWhenReadyAfterQueueReplacement(
                wasPlaying = ctrl.playWhenReady,
                userRequestedPlay = queueSyncPlayRequested || hasUnconsumedUserPlayRequest
            )
            queueSyncPlayRequested = false
            if (hasUnconsumedUserPlayRequest) {
                lastConsumedPlayRequestGeneration = npState.playRequestGeneration
            }
            ctrl.prepare()
        } else {
            // Current track is unchanged — apply a minimal diff that preserves the active media
            // item so shuffle/unshuffle does not force the playing song to reload from 0:00.
            applyDiffOps(ctrl, desiredItems, desiredIds, controllerCurrentId, desiredCurrentIndex)
            val postStructuralDescriptors = descriptorsAfterStructuralDiff(
                previousItems = lastSyncedDescriptors,
                desiredItems = desired.descriptors
            )
            val replacedCurrentMode = applyModeItemReplacements(
                ctrl = ctrl,
                desired = desired,
                postStructuralDescriptors = postStructuralDescriptors,
                preserveCurrent = retainCurrent
            )
            if (replacedCurrentMode) {
                desired.resolved.getOrNull(desiredCurrentIndex)?.let { currentResolved ->
                    nowPlayingManager.recordActualMode(currentResolved.queueId, currentResolved.actualMode)
                }
            }
            if (hasUnconsumedUserPlayRequest) {
                ctrl.play()
                lastConsumedPlayRequestGeneration = npState.playRequestGeneration
            }
        }

        lastSyncedMediaIds = desiredIds
        lastSyncedDescriptors = if (retainCurrent) {
            val previousDescriptors = lastSyncedDescriptors
            desired.descriptors.mapIndexed { index, descriptor ->
                if (desiredItems[index].mediaId == controllerCurrentId) {
                    previousDescriptors.firstOrNull { it.mediaId == controllerCurrentId } ?: descriptor
                } else {
                    descriptor
                }
            }
        } else {
            desired.descriptors
        }
        updatePlaybackModeState(
            desired.resolved.getOrNull(desiredCurrentIndex)?.queueId,
            desired.resolved.getOrNull(desiredCurrentIndex)
        )
        lastSyncedVersion = npState.queueVersion
        rememberQueueStructure(npState)
        applyCurrentPreferenceTransportDecision(ctrl, npState)
    }

    /** Applies a current dislike once after the winning queue sync, leaving pause state intact. */
    private fun applyCurrentPreferenceTransportDecision(
        ctrl: MediaController,
        npState: NowPlayingState
    ) {
        val currentEntry = npState.currentEntry ?: run {
            pendingPreferenceSkipQueueId = null
            return
        }
        val currentQueueId = currentEntry.queueId
        val currentMediaId = ctrl.currentMediaItem?.mediaId
        if (currentMediaId != currentQueueId.toString()) {
            pendingPreferenceSkipQueueId = null
            return
        }
        val currentResolved = resolvedItemsByQueueId[currentQueueId]
        if (isAllowedByPreference(currentEntry, currentResolved?.actualMode)) {
            pendingPreferenceSkipQueueId = null
            return
        }

        // Room/server preference emissions may reach separate collectors before Media3 reports
        // the transition. The queue occurrence guard makes those emissions one skip, including
        // the no-next-item stop case. Explicit unskip remains allowed by isAllowedByPreference.
        when (
            preferenceSkipAction(
                currentQueueId = currentQueueId,
                currentMediaId = currentMediaId,
                pendingQueueId = pendingPreferenceSkipQueueId,
                    hasNextMediaItem = ctrl.hasNextMediaItem() &&
                        ctrl.nextMediaItemIndex != ctrl.currentMediaItemIndex
            )
        ) {
            PreferenceSkipAction.SEEK_NEXT -> {
                pendingPreferenceSkipQueueId = currentQueueId
                ctrl.seekToNext()
            }
            PreferenceSkipAction.STOP -> {
                pendingPreferenceSkipQueueId = currentQueueId
                ctrl.stop()
            }
            PreferenceSkipAction.NONE -> Unit
        }
    }

    private fun clearSyncedQueueState(queueVersion: Long) {
        lastSyncedMediaIds = emptyList()
        lastSyncedDescriptors = emptyList()
        resolvedItemsByQueueId = emptyMap()
        lastSyncedQueueStructure = null
        lastSyncedVersion = queueVersion
    }

    private fun rememberQueueStructure(npState: NowPlayingState) {
        lastSyncedResolutionRevision = resolutionRevision
        lastSyncedQueueStructure = SyncedQueueStructure(
            queueEntryIds = npState.nowPlayingEntries.map(QueueEntry::queueId),
            currentQueueId = npState.currentEntry?.queueId,
            playbackIntent = npState.playbackIntent,
            modeSelectionGeneration = npState.modeSelectionGeneration
        )
    }

    /**
     * Build the list of [MediaItem]s the controller should hold for [npState], honoring the
     * dislike/unskip filter, and the desired current index within that filtered list.
     */
    private suspend fun applyPreferenceQueueFilter(
        ctrl: MediaController,
        npState: NowPlayingState,
        preserveCurrentPlayback: Boolean = true
    ) {
        // The winning queue sync owns the transport decision. A preference and an availability
        // invalidation can race; applying skip only after a successful commit prevents either
        // collector from losing the immediate current-dislike action.
        forceSyncQueue(ctrl, npState, preserveCurrentPlayback = preserveCurrentPlayback)
    }

    private suspend fun buildDesiredItems(
        npState: NowPlayingState,
        preserveCurrentPlayback: Boolean = false
    ): DesiredPlaybackQueue? = coroutineScope {
        val includedEntries = npState.nowPlayingEntries.filterIndexed { idx, entry ->
            shouldIncludeInPlayer(idx, entry, npState)
        }
        val currentQueueId = npState.currentEntry?.queueId
        // Previous and repeat-all can begin playback before Media3 emits a transition callback.
        // Keep already-played non-current occurrences on their recorded source so a newer queue
        // desire cannot rewrite playback history before that callback has a chance to arm replay.
        val resolutionEntries = entriesWithRecordedReplaySources(includedEntries, currentQueueId)
        val entriesByQueueId = includedEntries.associateBy { it.queueId }
        val previousCurrent = currentQueueId?.let(resolvedItemsByQueueId::get)
        val resolved = playbackResolutionCoordinator
            .resolveAll(resolutionEntries, npState.playbackIntent)
            .filter { resolved ->
                if (preserveCurrentPlayback && resolved.queueId == currentQueueId && previousCurrent != null) {
                    true
                } else {
                    resolved.isPlayable && isAllowedByPreference(
                        entry = entriesByQueueId.getValue(resolved.queueId),
                        actualMode = resolved.actualMode
                    )
                }
            }
            .map { resolved ->
                if (preserveCurrentPlayback && resolved.queueId == currentQueueId) {
                    retainCurrentPlaybackSource(previousCurrent, resolved)
                } else {
                    resolved
                }
            }
        val bluetoothMetadataStyle = playbackPreferences.bluetoothMetadataStyle
        val descriptors = resolved.map { item ->
            item.toPlaybackMediaDescriptor(serverSettingsStore.serverBaseUrl, bluetoothMetadataStyle)
        }
        val items = resolved.map { item ->
            val entry = entriesByQueueId[item.queueId]
            val anime = entry?.item?.anime
                ?: entry?.themeOrNull?.animeId?.let(npState.animeMap::get)
            item.toPlaybackMediaItem(
                artworkData = anime?.let(::cachedArtworkDataForAnime),
                activeServerBaseUrl = serverSettingsStore.serverBaseUrl,
                bluetoothMetadataStyle = bluetoothMetadataStyle
            )
        }
        val currentIndex = desiredCurrentIndexAfterFiltering(
            originalEntries = npState.nowPlayingEntries,
            currentQueueId = npState.currentEntry?.queueId,
            resolvedQueueIds = resolved.map { it.queueId }
        ) ?: return@coroutineScope null
        DesiredPlaybackQueue(items, descriptors, resolved, currentIndex)
    }

    private fun applyModeItemReplacements(
        ctrl: MediaController,
        desired: DesiredPlaybackQueue,
        postStructuralDescriptors: List<PlaybackMediaDescriptor>,
        preserveCurrent: Boolean = false
    ): Boolean {
        val desiredMediaById = desired.items.associateBy { it.mediaId }
        val adapter = object : PlaybackItemController {
            override val items = postStructuralDescriptors.toMutableList()
            override var currentIndex: Int = ctrl.currentMediaItemIndex
            override var playWhenReady: Boolean
                get() = ctrl.playWhenReady
                set(value) {
                    ctrl.playWhenReady = value
                }

            override fun replaceMediaItem(index: Int, item: PlaybackMediaDescriptor) {
                desiredMediaById[item.mediaId]?.let { ctrl.replaceMediaItem(index, it) }
                items[index] = item
            }

            override fun seekTo(index: Int, positionMs: Long) {
                ctrl.seekTo(index, positionMs)
                currentIndex = index
            }

            override fun prepare() = ctrl.prepare()
        }
        return replaceModeChangedPlaybackItems(
            controller = adapter,
            desiredItems = desired.descriptors,
            preserveCurrent = preserveCurrent
        )
    }

    private fun cachedArtworkDataForAnime(anime: AnimeEntity): ByteArray? {
        val urls = anime.primaryArtworkUrls()
        if (urls.isEmpty()) return null
        return artworkDataCache.get(artworkCacheKey(anime, urls))
    }

    private fun artworkCacheKey(anime: AnimeEntity, urls: List<String>): String =
        "${anime.animeThemesId ?: anime.kitsuId}:${urls.joinToString("|")}"

    private fun applyDiffOps(
        ctrl: MediaController,
        desiredItems: List<MediaItem>,
        desiredIds: List<String>,
        currentMediaId: String?,
        desiredCurrentIndex: Int
    ) {
        val currentIds = ctrl.mediaIds()
        val ops = computeQueueOpsPreservingCurrent(
            old = currentIds.ifEmpty { lastSyncedMediaIds },
            new = desiredIds,
            currentMediaId = currentMediaId,
            desiredCurrentIndex = desiredCurrentIndex
        )
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

    private fun MediaController.mediaIds(): List<String> =
        (0 until mediaItemCount).map { index -> getMediaItemAt(index).mediaId }

    private fun startPositionPolling() {
        scope.launch {
            positionPollingActive.collectLatest { isPlaying ->
                val intervalMs = playbackPositionPollIntervalMs(isPlaying) ?: return@collectLatest
                while (isActive && positionPollingActive.value) {
                    controller?.let(::updatePlaybackPositionFromController)
                    delay(intervalMs)
                }
            }
        }
    }

    private fun updatePlaybackPositionFromController(ctrl: MediaController) {
        val duration = ctrl.duration.takeIf { it > 0 } ?: 1L
        val mediaItem = ctrl.currentMediaItem
        val queueId = mediaItem?.mediaId?.toLongOrNull()
        val resolved = resolvedItemsByQueueId[queueId]
        _playbackState.value = mergeControllerProgressIntoPlaybackState(
            previous = _playbackState.value,
            isPlaying = ctrl.isPlaying,
            positionMs = ctrl.currentPosition,
            durationMs = duration,
            bufferedPositionMs = ctrl.bufferedPosition,
            isBuffering = ctrl.playbackState == Player.STATE_BUFFERING,
            hasMedia = ctrl.mediaItemCount > 0,
        ).copy(
            queueId = queueId,
            preferredMode = resolved?.preferredMode,
            actualMode = resolved?.actualMode,
            availableModes = resolved?.availableModes.orEmpty(),
            retainedIntentReason = resolved?.retainedIntentReason,
            dislikedModes = resolved?.dislikedModes.orEmpty(),
            videoSpoiler = resolved?.videoSpoiler ?: false,
            videoNsfw = resolved?.videoNsfw ?: false
        )
    }

    private fun updatePlaybackModeState(queueId: Long?, resolved: ResolvedPlaybackItem?) {
        _playbackState.value = _playbackState.value.withResolvedPlayback(queueId, resolved)
    }

    // --- Playback controls (delegate to MediaController) ---

    fun play() {
        queueSyncPlayRequested = true
        markPlaybackStateDirty()
        controller?.play()
    }

    fun pause() {
        queueSyncPlayRequested = false
        // A queue resolution may still be in flight after NowPlayingManager.play().
        // Consume every play request observed at the instant of this explicit pause so
        // the eventual queue commit cannot resurrect playback. A later user play bumps
        // the generation again and remains actionable.
        lastConsumedPlayRequestGeneration = playRequestGenerationAfterPause(
            nowPlayingManager.state.value.playRequestGeneration
        )
        markPlaybackStateDirty()
        controller?.pause()
    }
    fun seekTo(positionMs: Long) {
        markPlaybackStateDirty()
        controller?.seekTo(positionMs)
    }
    fun seekToNext() {
        markPlaybackStateDirty()
        controller?.seekToNext()
    }
    fun seekToPrevious() {
        markPlaybackStateDirty()
        controller?.seekToPrevious()
    }

    fun seekBackTenSeconds() {
        markPlaybackStateDirty()
        controller?.let { ctrl ->
            val newPosition = (ctrl.currentPosition - 10_000).coerceAtLeast(0L)
            ctrl.seekTo(newPosition)
        }
    }

    fun toggleRepeatMode() {
        markPlaybackStateDirty()
        controller?.let { ctrl ->
            ctrl.repeatMode = when (ctrl.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
            _playbackState.value = _playbackState.value.copy(repeatMode = ctrl.repeatMode)
        }
    }

    /**
     * Lifecycle owners call this rather than blocking the main thread for a second persistence
     * write. The normal debounced collector remains authoritative; this only covers a queue
     * mutation that has not reached its debounce deadline yet.
     */
    fun schedulePlaybackStatePersistenceIfNeeded(): Boolean {
        if (!shouldSchedulePlaybackTeardownPersist(playbackStateDirty.get())) return false
        if (!playbackStateDirty.compareAndSet(true, false)) return false

        val state = nowPlayingManager.state.value
        val revision = playbackStateRevision.get()
        // Capture Media3 values before MediaPlaybackService releases its player/session. The
        // singleton's supervisor scope remains alive to perform only the file I/O afterward.
        val positionMs = controller?.currentPosition ?: _playbackState.value.positionMs
        val repeatMode = controller?.repeatMode ?: Player.REPEAT_MODE_OFF
        scope.launch {
            persistPlaybackSnapshot(state, positionMs, repeatMode, revision)
        }
        return true
    }

val repeatMode: Int
    get() = controller?.repeatMode ?: Player.REPEAT_MODE_OFF
}

/** Distinguishes server transitions from local media changes so going offline does not
 * rebuild the current server item out of the Media3 queue. */
internal sealed interface PlaybackAvailabilityChange {
    data class ServerReachability(val reachable: Boolean) : PlaybackAvailabilityChange
    data object MediaInvalidation : PlaybackAvailabilityChange
}

internal fun playbackAvailabilityChanges(
    serverReachable: Flow<Boolean>,
    mediaInvalidations: Flow<Unit>
): Flow<PlaybackAvailabilityChange> = merge(
    serverReachable.distinctUntilChanged().map {
        PlaybackAvailabilityChange.ServerReachability(it)
    },
    mediaInvalidations.map { PlaybackAvailabilityChange.MediaInvalidation }
)

internal fun isQueueEntryAllowedByPreference(
    entry: QueueEntry,
    actualMode: PlaybackMode?,
    themePreferences: Map<Long, UserPreferenceEntity>,
    dislikedSongIds: Set<Long>,
    unskippedEntryIds: Set<Long>
): Boolean {
    if (entry.queueId in unskippedEntryIds) return true
    return when (val item = entry.item) {
        is PlayableItem.RelatedSong -> item.song.id !in dislikedSongIds
        is PlayableItem.Theme -> {
            val preference = themePreferences[item.theme.id] ?: return true
            when {
                preference.isDisliked -> false
                actualMode == PlaybackMode.TV_SIZE -> !preference.isDislikedTvSize
                actualMode == PlaybackMode.FULL_SIZE -> !preference.isDislikedFullSize
                else -> true
            }
        }
    }
}

internal fun newlyDislikedThemeOccurrence(
    entry: QueueEntry,
    actualMode: PlaybackMode?,
    previous: UserPreferenceEntity?,
    next: UserPreferenceEntity?
): Boolean {
    if (entry.item !is PlayableItem.Theme || next == null) return false
    val broad = next.isDisliked && previous?.isDisliked != true
    val variant = when (actualMode) {
        PlaybackMode.TV_SIZE -> next.isDislikedTvSize && previous?.isDislikedTvSize != true
        PlaybackMode.FULL_SIZE -> next.isDislikedFullSize && previous?.isDislikedFullSize != true
        else -> false
    }
    return broad || variant
}

internal enum class PreferenceSkipAction { NONE, SEEK_NEXT, STOP }

/** Returns one transport action for a disliked current occurrence, suppressing duplicate writes. */
internal fun preferenceSkipAction(
    currentQueueId: Long?,
    currentMediaId: String?,
    pendingQueueId: Long?,
    hasNextMediaItem: Boolean
): PreferenceSkipAction {
    if (currentQueueId == null || currentMediaId != currentQueueId.toString()) {
        return PreferenceSkipAction.NONE
    }
    if (pendingQueueId == currentQueueId) return PreferenceSkipAction.NONE
    return if (hasNextMediaItem) PreferenceSkipAction.SEEK_NEXT else PreferenceSkipAction.STOP
}

/**
 * When a current item becomes ineligible only after resolution (for example a
 * scoped TV/Full dislike), keep playback moving forward in the original queue.
 */
internal fun desiredCurrentIndexAfterFiltering(
    originalEntries: List<QueueEntry>,
    currentQueueId: Long?,
    resolvedQueueIds: List<Long>
): Int? {
    if (currentQueueId == null) return 0.takeIf { resolvedQueueIds.isNotEmpty() }
    val currentResolvedIndex = resolvedQueueIds.indexOf(currentQueueId)
    if (currentResolvedIndex >= 0) return currentResolvedIndex

    val originalCurrentIndex = originalEntries.indexOfFirst { it.queueId == currentQueueId }
    if (originalCurrentIndex >= 0) {
        val nextEligibleQueueId = originalEntries
            .drop(originalCurrentIndex + 1)
            .firstOrNull { it.queueId in resolvedQueueIds }
            ?.queueId
        val nextResolvedIndex = resolvedQueueIds.indexOf(nextEligibleQueueId)
        if (nextResolvedIndex >= 0) return nextResolvedIndex
    }
    return null
}

data class PlaybackState(
    val isPlaying: Boolean = false,
    val positionMs: Long = 0L,
    val durationMs: Long = 1L,
    val bufferedPositionMs: Long = 0L,
    val isBuffering: Boolean = false,
    val hasMedia: Boolean = false,
    val errorMessage: String? = null,
    val repeatMode: Int = Player.REPEAT_MODE_OFF,
    val queueId: Long? = null,
    val preferredMode: PlaybackMode? = null,
    val actualMode: PlaybackMode? = null,
    val availableModes: Set<PlaybackMode> = emptySet(),
    val retainedIntentReason: RetainedIntentReason? = null,
    val videoSpoiler: Boolean = false,
    val videoNsfw: Boolean = false,
    /** Variant dislikes are exposed for the picker while remaining selectable explicitly. */
    val dislikedModes: Set<PlaybackMode> = emptySet()
)

data class MediaControllerConnectionState(
    val isReady: Boolean = false,
    val retryAttempt: Int = 0,
    val errorMessage: String? = null,
)

internal fun PlaybackState.withServerUnavailable(): PlaybackState = copy(
    availableModes = setOfNotNull(actualMode)
)

internal fun PlaybackState.withResolvedPlayback(
    queueId: Long?,
    resolved: ResolvedPlaybackItem?
): PlaybackState = copy(
    errorMessage = null,
    queueId = queueId,
    preferredMode = resolved?.preferredMode,
    actualMode = resolved?.actualMode,
    availableModes = resolved?.availableModes.orEmpty(),
    retainedIntentReason = resolved?.retainedIntentReason,
    dislikedModes = resolved?.dislikedModes.orEmpty(),
    videoSpoiler = resolved?.videoSpoiler ?: false,
    videoNsfw = resolved?.videoNsfw ?: false
)

private data class DesiredPlaybackQueue(
    val items: List<MediaItem>,
    val descriptors: List<PlaybackMediaDescriptor>,
    val resolved: List<ResolvedPlaybackItem>,
    val currentIndex: Int
)

internal fun entriesWithRecordedReplaySources(
    entries: List<QueueEntry>,
    currentQueueId: Long?
): List<QueueEntry> = entries.map { entry ->
    if (entry.queueId != currentQueueId && entry.lastActualMode != null) {
        entry.copy(replayRequested = true)
    } else {
        entry
    }
}
