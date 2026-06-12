package com.takeya.animeongaku.media

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
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
                val activeState = nowPlayingManager.state.value
                if (activeState.nowPlaying.isNotEmpty()) {
                    val playbackItems = activeState.toPlaybackMediaItems()
                    return SettableFuture.create<MediaSession.MediaItemsWithStartPosition>().apply {
                        set(
                            MediaSession.MediaItemsWithStartPosition(
                                playbackItems.items,
                                playbackItems.currentIndex,
                                player.currentPosition.takeIf { it > 0 } ?: C.TIME_UNSET
                            )
                        )
                    }
                }

                val future = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
                scope.launch {
                    try {
                        val restored = nowPlayingPersistence.restore()
                        if (restored == null) {
                            future.set(
                                MediaSession.MediaItemsWithStartPosition(
                                    emptyList(),
                                    0,
                                    C.TIME_UNSET
                                )
                            )
                            return@launch
                        }

                        player.repeatMode = restored.repeatMode
                        mediaControllerManager.prepareForSessionResumption(restored)

                        val playbackItems = restored.nowPlayingState.toPlaybackMediaItems()
                        future.set(
                            MediaSession.MediaItemsWithStartPosition(
                                playbackItems.items,
                                playbackItems.currentIndex,
                                restored.positionMs
                            )
                        )
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

        val notificationProvider = DefaultMediaNotificationProvider(this)
        notificationProvider.setSmallIcon(R.drawable.ic_notification)
        setMediaNotificationProvider(notificationProvider)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession = mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        saveStateSynchronously()
    }

    override fun onDestroy() {
        saveStateSynchronously()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }

    private fun saveStateSynchronously() {
        val state = nowPlayingManager.state.value
        if (state.nowPlaying.isNotEmpty()) {
            val pos = player.currentPosition
            val rep = player.repeatMode
            // Use runBlocking to ensure it saves before the process is killed
            kotlinx.coroutines.runBlocking(Dispatchers.IO) {
                nowPlayingPersistence.save(state, pos, rep)
            }
        }
    }
}
