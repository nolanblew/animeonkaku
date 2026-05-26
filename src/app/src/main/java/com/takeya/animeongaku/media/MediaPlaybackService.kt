package com.takeya.animeongaku.media

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import com.takeya.animeongaku.MainActivity
import com.takeya.animeongaku.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import androidx.media3.session.SessionResult
import javax.inject.Inject

@UnstableApi
@AndroidEntryPoint
class MediaPlaybackService : MediaLibraryService() {

    @Inject lateinit var audioCacheProvider: AudioCacheProvider
    @Inject lateinit var nowPlayingManager: NowPlayingManager
    @Inject lateinit var nowPlayingPersistence: NowPlayingPersistence
    @Inject lateinit var mediaControllerManager: MediaControllerManager
    @Inject lateinit var androidAutoMediaLibrary: AndroidAutoMediaLibrary

    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaLibrarySession
    
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

        val callback = object : MediaLibrarySession.Callback {
            override fun onPlaybackResumption(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo
            ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                if (nowPlayingManager.state.value.nowPlaying.isEmpty()) {
                    // Start restore asynchronously, but we must return something immediately.
                    // For Media3, we can just return a future that resolves when ready,
                    // or let it start empty and update the queue later.
                    scope.launch {
                        val restored = nowPlayingPersistence.restore()
                        if (restored != null) {
                            mediaControllerManager.restore(restored, autoPlay = true)
                        } else {
                            player.play()
                        }
                    }
                }
                return super.onPlaybackResumption(mediaSession, controller)
            }

            override fun onGetLibraryRoot(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<androidx.media3.common.MediaItem>> =
                futureFromIo { androidAutoMediaLibrary.getRoot(params) }

            override fun onGetItem(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                mediaId: String
            ): ListenableFuture<LibraryResult<androidx.media3.common.MediaItem>> =
                futureFromIo { androidAutoMediaLibrary.getItem(mediaId, null) }

            override fun onGetChildren(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                parentId: String,
                page: Int,
                pageSize: Int,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<com.google.common.collect.ImmutableList<androidx.media3.common.MediaItem>>> =
                futureFromIo { androidAutoMediaLibrary.getChildren(parentId, page, pageSize, params) }

            override fun onSearch(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                query: String,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<Void>> =
                Futures.immediateFuture(LibraryResult.ofVoid(params))

            override fun onGetSearchResult(
                session: MediaLibrarySession,
                browser: MediaSession.ControllerInfo,
                query: String,
                page: Int,
                pageSize: Int,
                params: LibraryParams?
            ): ListenableFuture<LibraryResult<com.google.common.collect.ImmutableList<androidx.media3.common.MediaItem>>> =
                futureFromIo { androidAutoMediaLibrary.getSearchResults(query, page, pageSize, params) }

            override fun onSetMediaItems(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo,
                mediaItems: List<androidx.media3.common.MediaItem>,
                startIndex: Int,
                startPositionMs: Long
            ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
                val mediaIds = mediaItems.map { it.mediaId }
                if (mediaIds.any { AndroidAutoMediaId.parse(it) != null }) {
                    return futureFromIo {
                        androidAutoMediaLibrary.preparePlayback(mediaIds, startIndex, startPositionMs)
                            ?: MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs)
                    }
                }
                return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
            }

            override fun onAddMediaItems(
                mediaSession: MediaSession,
                controller: MediaSession.ControllerInfo,
                mediaItems: List<androidx.media3.common.MediaItem>
            ): ListenableFuture<List<androidx.media3.common.MediaItem>> {
                if (mediaItems.any { AndroidAutoMediaId.parse(it.mediaId) != null }) {
                    return futureFromIo { androidAutoMediaLibrary.resolvePlayableItems(mediaItems) }
                }
                return super.onAddMediaItems(mediaSession, controller, mediaItems)
            }
        }

        mediaSession = MediaLibrarySession.Builder(this, player, callback)
            .setSessionActivity(sessionActivity)
            .build()

        val notificationProvider = DefaultMediaNotificationProvider(this)
        notificationProvider.setSmallIcon(R.drawable.ic_notification)
        setMediaNotificationProvider(notificationProvider)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = mediaSession

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

    private fun <T> futureFromIo(
        dispatcher: CoroutineDispatcher = Dispatchers.IO,
        block: suspend () -> T
    ): ListenableFuture<T> {
        val future = SettableFuture.create<T>()
        scope.launch(dispatcher) {
            try {
                future.set(block())
            } catch (throwable: Throwable) {
                future.setException(throwable)
            }
        }
        return future
    }
}
