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
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.UUID
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
@androidx.annotation.OptIn(UnstableApi::class)
class MediaControllerManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val nowPlayingManager: NowPlayingManager,
    private val playCountDao: PlayCountDao,
    private val pendingPlayDao: PendingPlayDao,
    private val userPreferencesRepository: UserPreferencesRepository,
    private val nowPlayingPersistence: NowPlayingPersistence,
    private val connectivityMonitor: ConnectivityMonitor,
    private val serverSettingsStore: ServerSettingsStore,
    private val imageLoader: ImageLoader,
    private val playbackResolutionCoordinator: PlaybackResolutionCoordinator
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val artworkDataCache = ArtworkDataCache()

    private var controller: MediaController? = null
    private var lastSyncedVersion: Long = -1L
    private var lastSyncedMediaIds: List<String> = emptyList()
    private var lastSyncedDescriptors: List<PlaybackMediaDescriptor> = emptyList()
    private var resolvedItemsByQueueId: Map<Long, ResolvedPlaybackItem> = emptyMap()
    private val latestQueueSync = LatestPlaybackQueueSync()
    private val videoFallbackAttempts = VideoFallbackAttemptRegistry()
    
    // Store restored state that should be applied once controller connects
    private var pendingRestoreState: Pair<RestoredQueueState, Boolean>? = null

    private val _playbackState = MutableStateFlow(PlaybackState())
    val playbackState: StateFlow<PlaybackState> = _playbackState.asStateFlow()

    private val _mediaController = MutableStateFlow<MediaController?>(null)
    val mediaController: StateFlow<MediaController?> = _mediaController.asStateFlow()

    private val _controllerReady = MutableStateFlow(false)

    private var consecutiveErrors = 0
    private val MAX_CONSECUTIVE_ERRORS = 5

    private var cachedThemePreferences: Map<Long, UserPreferenceEntity> = emptyMap()
    private var cachedDislikedSongIds: Set<Long> = emptySet()
    private val artworkPreloadAheadCount = 3

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
            val queueEntryId = mediaItem?.mediaId?.toLongOrNull()
            updatePlaybackModeState(queueEntryId, resolvedItemsByQueueId[queueEntryId])
            if (queueEntryId != null) {
                val entry = nowPlayingManager.state.value.nowPlayingEntries
                    .firstOrNull { it.queueId == queueEntryId }

                nowPlayingManager.onTrackChangedByQueueId(queueEntryId)
                
                // Record play count on track start
                entry?.let { queueEntry ->
                    scope.launch { recordPlay(queueEntry, resolvedItemsByQueueId[queueEntryId]) }
                }
            }
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
            if (!fallback.isPlayable || fallback.actualMode != PlaybackMode.TV_SIZE) return false

            val index = (0 until ctrl.mediaItemCount).firstOrNull { idx ->
                ctrl.getMediaItemAt(idx).mediaId == queueId.toString()
            } ?: return false
            val wasPlayWhenReady = ctrl.playWhenReady
            val artwork = entry.item.anime?.let(::cachedArtworkDataForAnime)
            ctrl.replaceMediaItem(
                index,
                fallback.toPlaybackMediaItem(
                    artworkData = artwork,
                    activeServerBaseUrl = serverSettingsStore.serverBaseUrl
                )
            )
            ctrl.seekTo(index, 0L)
            ctrl.playWhenReady = wasPlayWhenReady
            ctrl.prepare()

            resolvedItemsByQueueId = resolvedItemsByQueueId + (queueId to fallback)
            lastSyncedDescriptors = lastSyncedDescriptors.map { descriptor ->
                if (descriptor.mediaId == queueId.toString()) {
                    fallback.toPlaybackMediaDescriptor(serverSettingsStore.serverBaseUrl)
                } else descriptor
            }
            _playbackState.value = _playbackState.value.copy(
                errorMessage = "Video unavailable · playing TV Size",
                isBuffering = false,
                preferredMode = PlaybackMode.VIDEO,
                actualMode = PlaybackMode.TV_SIZE,
                availableModes = fallback.availableModes,
                retainedIntentReason = fallback.retainedIntentReason,
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
        val future = MediaController.Builder(context, sessionToken).buildAsync()
        future.addListener(
            {
                val ctrl = future.get()
                controller = ctrl
                _mediaController.value = ctrl
                ctrl.addListener(playerListener)
                _controllerReady.value = true

                // Read initial state from controller
                updatePlaybackPositionFromController(ctrl)
                
                // If we had a pending restore, apply it now
                pendingRestoreState?.let { (state, autoPlay) ->
                    pendingRestoreState = null
                    scope.launch { restoreFromPersistedState(state, ctrl, autoPlay) }
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
                    userPreferencesRepository.observeAllPreferences().collectLatest { preferences ->
                        cachedThemePreferences = preferences.associateBy { it.themeId }

                        val ctrl = controller ?: return@collectLatest
                        val npState = nowPlayingManager.state.value
                        
                        // We must re-sync the queue around the current item in case upcoming skips changed
                        if (npState.nowPlayingEntries.isNotEmpty()) {
                            applyPreferenceQueueFilter(ctrl, npState)
                        }
                    }
                }
                scope.launch {
                    userPreferencesRepository.observeDislikedSongIds().collectLatest { dislikedSongIds ->
                        cachedDislikedSongIds = dislikedSongIds.toSet()
                        controller?.let { ctrl ->
                            val state = nowPlayingManager.state.value
                            if (state.nowPlayingEntries.isNotEmpty()) applyPreferenceQueueFilter(ctrl, state)
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
                    if (state.nowPlayingEntries.isNotEmpty()) {
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
            scope.launch { restoreFromPersistedState(restoredState, ctrl, autoPlay) }
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
    }

    private suspend fun syncQueueToController(ctrl: MediaController, npState: NowPlayingState) {
        if (lastSyncedVersion == npState.queueVersion) return
        forceSyncQueue(ctrl, npState)
    }

    /**
     * Applies the desired queue state to the controller using the minimal number of batched
     * Media3 calls. Bypasses the [lastSyncedVersion] fast-path so callers such as the disliked-
     * tracks observer (which mutates the filter without bumping [NowPlayingState.queueVersion])
     * still converge.
     */
    private suspend fun forceSyncQueue(ctrl: MediaController, npState: NowPlayingState) {
        latestQueueSync.runLatest(
            resolve = {
                if (npState.nowPlayingEntries.isEmpty()) null else buildDesiredItems(npState)
            },
            commit = { desired -> commitQueueSync(ctrl, npState, desired) }
        )
    }

    private fun commitQueueSync(
        ctrl: MediaController,
        npState: NowPlayingState,
        desired: DesiredPlaybackQueue?
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

        if (controllerCurrentId == null || controllerCurrentId != expectedCurrentId) {
            // Current track needs to change (play new context, skipTo, rewindTo, fresh connect).
            // One batched IPC replaces the whole queue and seeks to the new current track.
            ctrl.setMediaItems(desiredItems, desiredCurrentIndex, C.TIME_UNSET)
            ctrl.playWhenReady = true
            ctrl.prepare()
        } else {
            // Current track is unchanged — apply a minimal diff that preserves the active media
            // item so shuffle/unshuffle does not force the playing song to reload from 0:00.
            applyDiffOps(ctrl, desiredItems, desiredIds, controllerCurrentId, desiredCurrentIndex)
            applyModeItemReplacements(
                ctrl = ctrl,
                desired = desired,
                postStructuralDescriptors = descriptorsAfterStructuralDiff(
                    previousItems = lastSyncedDescriptors,
                    desiredItems = desired.descriptors
                )
            )
        }

        lastSyncedMediaIds = desiredIds
        lastSyncedDescriptors = desired.descriptors
        updatePlaybackModeState(
            desired.resolved.getOrNull(desiredCurrentIndex)?.queueId,
            desired.resolved.getOrNull(desiredCurrentIndex)
        )
        lastSyncedVersion = npState.queueVersion
    }

    private fun clearSyncedQueueState(queueVersion: Long) {
        lastSyncedMediaIds = emptyList()
        lastSyncedDescriptors = emptyList()
        resolvedItemsByQueueId = emptyMap()
        lastSyncedVersion = queueVersion
    }

    /**
     * Build the list of [MediaItem]s the controller should hold for [npState], honoring the
     * dislike/unskip filter, and the desired current index within that filtered list.
     */
    private suspend fun applyPreferenceQueueFilter(ctrl: MediaController, npState: NowPlayingState) {
        val currentEntry = npState.currentEntry
        val currentResolved = currentEntry?.let { resolvedItemsByQueueId[it.queueId] }
        if (currentEntry != null && !isAllowedByPreference(currentEntry, currentResolved?.actualMode)) {
            // Keep the current Media3 item until it advances. Rebuilding the queue first
            // can remove index zero and make a dislike jump backward instead of forward.
            if (ctrl.hasNextMediaItem()) ctrl.seekToNext() else ctrl.stop()
            return
        }
        forceSyncQueue(ctrl, npState)
    }

    private suspend fun buildDesiredItems(npState: NowPlayingState): DesiredPlaybackQueue? = coroutineScope {
        val includedEntries = npState.nowPlayingEntries.filterIndexed { idx, entry ->
            shouldIncludeInPlayer(idx, entry, npState)
        }
        val resolved = includedEntries.map { entry ->
            async { playbackResolutionCoordinator.resolve(entry, npState.playbackIntent) }
        }.awaitAll().filter { resolved ->
            resolved.isPlayable && isAllowedByPreference(
                entry = includedEntries.first { it.queueId == resolved.queueId },
                actualMode = resolved.actualMode
            )
        }
        val entriesByQueueId = includedEntries.associateBy { it.queueId }
        val descriptors = resolved.map { item ->
            item.toPlaybackMediaDescriptor(serverSettingsStore.serverBaseUrl)
        }
        val items = resolved.map { item ->
            val entry = entriesByQueueId[item.queueId]
            val anime = entry?.item?.anime
                ?: entry?.themeOrNull?.animeId?.let(npState.animeMap::get)
            item.toPlaybackMediaItem(
                artworkData = anime?.let(::cachedArtworkDataForAnime),
                activeServerBaseUrl = serverSettingsStore.serverBaseUrl
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
        postStructuralDescriptors: List<PlaybackMediaDescriptor>
    ) {
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
        replaceModeChangedPlaybackItems(adapter, desired.descriptors)
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
        val mediaItem = ctrl.currentMediaItem
        val queueId = mediaItem?.mediaId?.toLongOrNull()
        val resolved = resolvedItemsByQueueId[queueId]
        _playbackState.value = PlaybackState(
            isPlaying = ctrl.isPlaying,
            positionMs = ctrl.currentPosition,
            durationMs = duration,
            bufferedPositionMs = ctrl.bufferedPosition,
            isBuffering = ctrl.playbackState == Player.STATE_BUFFERING,
            hasMedia = ctrl.mediaItemCount > 0,
            queueId = queueId,
            preferredMode = resolved?.preferredMode,
            actualMode = resolved?.actualMode,
            availableModes = resolved?.availableModes.orEmpty(),
            retainedIntentReason = resolved?.retainedIntentReason,
            videoSpoiler = resolved?.videoSpoiler ?: false,
            videoNsfw = resolved?.videoNsfw ?: false
        )
    }

    private fun updatePlaybackModeState(queueId: Long?, resolved: ResolvedPlaybackItem?) {
        _playbackState.value = _playbackState.value.withResolvedPlayback(queueId, resolved)
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
    val videoNsfw: Boolean = false
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
    videoSpoiler = resolved?.videoSpoiler ?: false,
    videoNsfw = resolved?.videoNsfw ?: false
)

private data class DesiredPlaybackQueue(
    val items: List<MediaItem>,
    val descriptors: List<PlaybackMediaDescriptor>,
    val resolved: List<ResolvedPlaybackItem>,
    val currentIndex: Int
)
