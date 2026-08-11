package com.takeya.animeongaku.media

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.BuildConfig
import com.takeya.animeongaku.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import javax.inject.Inject

@UnstableApi
@AndroidEntryPoint
class MediaPlaybackService : MediaSessionService() {

    @Inject lateinit var audioCacheProvider: AudioCacheProvider
    @Inject lateinit var nowPlayingManager: NowPlayingManager
    @Inject lateinit var nowPlayingPersistence: NowPlayingPersistence
    @Inject lateinit var mediaControllerManager: MediaControllerManager

    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession
    
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val sessionHydrationMutex = Mutex()

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(
                DefaultMediaSourceFactory(audioCacheProvider.playerDataSourceFactory)
            )
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            .build()
            .apply {
                setHandleAudioBecomingNoisy(true)
                addListener(object : Player.Listener {
                    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                        applyCurrentItemLoudness()
                    }

                    override fun onTimelineChanged(timeline: androidx.media3.common.Timeline, reason: Int) {
                        // Replacing a TV item with Full Size retains its queue media id, so it does
                        // not necessarily trigger a transition. Timeline updates arrive before the
                        // replacement is rendered and keep the gain constant for the item.
                        applyCurrentItemLoudness()
                    }

                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_READY) applyCurrentItemLoudness()
                    }
                })
            }

        val sessionActivity = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).apply {
                putExtra("navigate_to", "player")
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val callback = object : MediaSession.Callback {
            override fun onPlaybackResumption(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo
            ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                val future = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
                scope.launch {
                    try {
                        val result = sessionHydrationMutex.withLock {
                            val selected = selectSessionHydrationState(
                                nowPlayingManager.state.value,
                                nowPlayingPersistence.restore()
                            ) ?: return@withLock MediaSession.MediaItemsWithStartPosition(
                                emptyList(), 0, C.TIME_UNSET
                            )
                            val playbackItems = mediaControllerManager.prepareForSessionResumption(selected)
                            val selectedMediaId = playbackItems.items.getOrNull(playbackItems.currentIndex)?.mediaId
                            val position = if (player.currentMediaItem?.mediaId == selectedMediaId) {
                                player.currentPosition.takeIf { it > 0 } ?: selected.positionMs
                            } else {
                                selected.positionMs
                            }
                            MediaSession.MediaItemsWithStartPosition(
                                playbackItems.items,
                                playbackItems.currentIndex,
                                position
                            )
                        }
                        future.set(result)
                    } catch (e: Exception) {
                        future.setException(e)
                    }
                }
                return future
            }
        }

        mediaSession = MediaSession.Builder(this, player)
            .setSessionActivity(sessionActivity)
            .setCallback(callback)
            .build()

        // External controllers such as a car can display metadata before the first Play command.
        // Populate the paused player as soon as the service starts so that metadata and the item
        // which will actually play come from the same current queue entry.
        scope.launch {
            sessionHydrationMutex.withLock {
                if (player.mediaItemCount > 0) return@withLock
                val selected = selectSessionHydrationState(
                    nowPlayingManager.state.value,
                    nowPlayingPersistence.restore()
                ) ?: return@withLock
                val playbackItems = mediaControllerManager.prepareForSessionResumption(selected)
                if (playbackItems.items.isEmpty()) return@withLock
                player.setMediaItems(playbackItems.items, playbackItems.currentIndex, selected.positionMs)
                player.repeatMode = selected.repeatMode
                player.playWhenReady = false
                player.prepare()
            }
        }

        val notificationProvider = DefaultMediaNotificationProvider(this)
        notificationProvider.setSmallIcon(R.drawable.ic_notification)
        setMediaNotificationProvider(notificationProvider)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

    private fun applyCurrentItemLoudness() {
        // Player volume is per-app content gain; Android's device/media-stream volume is untouched.
        val volume = player.currentMediaItem?.loudnessPlayerVolume() ?: 1f
        if (BuildConfig.DEBUG) {
            Log.d("MediaPlaybackService", "Applying per-item loudness volume=$volume")
        }
        player.volume = volume
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        mediaControllerManager.schedulePlaybackStatePersistenceIfNeeded()
    }

    override fun onDestroy() {
        mediaControllerManager.schedulePlaybackStatePersistenceIfNeeded()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }
}

internal fun selectSessionHydrationState(
    activeState: NowPlayingState,
    persistedState: RestoredQueueState?
): RestoredQueueState? {
    if (activeState.nowPlayingEntries.isEmpty()) return persistedState
    val activeQueueId = activeState.currentEntry?.queueId
    val persistedQueueId = persistedState?.nowPlayingState?.currentEntry?.queueId
    return RestoredQueueState(
        nowPlayingState = activeState,
        positionMs = persistedState?.positionMs?.takeIf { activeQueueId == persistedQueueId } ?: 0L,
        repeatMode = persistedState?.repeatMode ?: Player.REPEAT_MODE_OFF
    )
}
