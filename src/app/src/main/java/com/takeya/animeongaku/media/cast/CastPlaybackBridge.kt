package com.takeya.animeongaku.media.cast

import android.content.Context
import android.widget.Toast
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.common.Player
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import com.google.android.gms.cast.framework.CastContext
import com.takeya.animeongaku.data.remote.OngakuCastApi
import com.takeya.animeongaku.data.remote.OngakuCastSession
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.media.PlaybackMediaExtras
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import okhttp3.HttpUrl.Companion.toHttpUrl

/** Swaps the session's transport, so every existing controller continues to control the TV. */
@UnstableApi
internal class CastPlaybackBridge(
    private val context: Context,
    private val local: Player,
    private val session: MediaSession,
    private val api: OngakuCastApi,
    private val settings: ServerSettingsStore,
    private val scope: CoroutineScope,
) {
    private var castContext: CastContext? = null
    private var remote: CastPlayer? = null
    private var access: OngakuCastSession? = null
    private var accessBase: String? = null
    private var connectionJob: Job? = null
    private var snapshotJob: Job? = null
    private data class Snapshot(val items: List<MediaItem>, val currentId: String?, val position: Long, val repeat: Int)
    private var lastRemoteSnapshot: Snapshot? = null

    private fun snapshot(player: Player) = Snapshot(
        (0 until player.mediaItemCount).map(player::getMediaItemAt),
        player.currentMediaItem?.mediaId, player.currentPosition, player.repeatMode
    )

    private fun rememberRemote(allowEmpty: Boolean = false) {
        val player = remote ?: return
        // Media3 clears the Cast timeline BEFORE onCastSessionUnavailable. Retain the last
        // live snapshot so a disconnect cannot restore the phone's stale pre-cast queue.
        if (session.player === player && player.isCastSessionAvailable && (allowEmpty || player.mediaItemCount > 0)) {
            lastRemoteSnapshot = snapshot(player)
        }
    }

    fun initialize() {
        try {
            val cast = CastContext.getSharedInstance(context)
            castContext = cast
            val converter = OngakuCastMediaItemConverter { path ->
                val credential = checkNotNull(access) { "Reconnect to refresh Cast access." }
                checkNotNull(accessBase).toHttpUrl().newBuilder()
                    .addPathSegments("v1/cast/audio/$path")
                    .addQueryParameter("castToken", credential.token).build().toString()
            }
            val player = CastPlayer(cast, converter)
            remote = player
            player.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) {
                    rememberRemote(allowEmpty = events.contains(Player.EVENT_TIMELINE_CHANGED))
                }
            })
            snapshotJob = scope.launch {
                while (isActive) {
                    rememberRemote()
                    delay(1_000)
                }
            }
            player.setSessionAvailabilityListener(object : SessionAvailabilityListener {
                override fun onCastSessionAvailable() = connect()
                override fun onCastSessionUnavailable() = disconnect()
            })
            if (player.isCastSessionAvailable) connect()
        } catch (_: RuntimeException) {
            // Cast is optional on devices without Play services.
        }
    }

    private fun connect() {
        val target = remote ?: return
        connectionJob?.cancel()
        connectionJob = scope.launch {
            try {
                val base = requireNotNull(settings.serverBaseUrl).trimEnd('/') + "/"
                val uri = base.toHttpUrl()
                require(uri.host !in setOf("localhost", "127.0.0.1", "::1")) {
                    "Chromecast needs a server address reachable from your TV."
                }
                // Refresh before switching, leaving phone playback intact if the server fails.
                access = api.createCastSession()
                accessBase = base
                if (!target.isCastSessionAvailable) return@launch
                // Session availability can arrive before the first receiver timeline. Fetch its
                // status before deciding whether this is an existing party or a fresh receiver.
                val client = castContext?.sessionManager?.currentCastSession?.remoteMediaClient ?: return@launch
                withTimeout(10_000) {
                    suspendCancellableCoroutine { continuation ->
                        client.requestStatus().setResultCallback { result ->
                            if (continuation.isActive) continuation.resume(result.status.isSuccess)
                        }
                    }.also { check(it) { "Unable to read Cast playback. Try reconnecting." } }
                }
                if (!target.isCastSessionAvailable) return@launch
                val receiverItems = (0 until target.mediaItemCount).map(target::getMediaItemAt)
                val localIds = (0 until local.mediaItemCount).map { local.getMediaItemAt(it).mediaId }.toSet()
                if (receiverItems.isNotEmpty() && receiverItems.all {
                        it.mediaId in localIds && castAudioPath(it.mediaMetadata.extras?.getString(PlaybackMediaExtras.MEDIA_KEY)) != null
                    }) {
                    // Session resume: the receiver owns its current position and pause state.
                    local.pause()
                    session.setPlayer(target)
                    rememberRemote()
                    return@launch
                }
                val items = (0 until local.mediaItemCount).map(local::getMediaItemAt)
                require(items.all { castAudioPath(it.mediaMetadata.extras?.getString(PlaybackMediaExtras.MEDIA_KEY)) != null }) {
                    "Casting supports audio queues. Switch Video tracks to TV Size or Full Size first."
                }
                val handoff = castHandoff(items.map { it.mediaId }, local.currentMediaItem?.mediaId,
                    local.currentPosition, local.playWhenReady, toCast = true)
                if (handoff != null) {
                    // All entries, including duplicates, retain their unique mediaId.
                    target.repeatMode = local.repeatMode
                    target.setMediaItems(items, handoff.index, handoff.positionMs)
                    target.playWhenReady = handoff.playWhenReady
                    target.prepare()
                }
                lastRemoteSnapshot = snapshot(local)
                local.pause()
                session.setPlayer(target)
            } catch (_: TimeoutCancellationException) {
                Toast.makeText(context, "The Cast device did not respond. Try reconnecting.", Toast.LENGTH_LONG).show()
                castContext?.sessionManager?.endCurrentSession(false)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                Toast.makeText(context, error.message ?: "Unable to start casting. Try reconnecting.", Toast.LENGTH_LONG).show()
                castContext?.sessionManager?.endCurrentSession(false)
            }
        }
    }

    private fun disconnect() {
        connectionJob?.cancel()
        val source = remote ?: return
        if (session.player !== source) return
        val saved = lastRemoteSnapshot
        val items = saved?.items.orEmpty()
        val handoff = castHandoff(items.map { it.mediaId }, saved?.currentId,
            saved?.position ?: 0L, false, toCast = false)
        local.pause()
        if (handoff != null) {
            local.setMediaItems(items, handoff.index, handoff.positionMs)
            local.repeatMode = saved!!.repeat
            local.prepare()
        } else if (saved != null && saved.items.isEmpty()) {
            local.clearMediaItems()
        }
        // A lost connection must never suddenly play through the phone's speaker.
        session.setPlayer(local)
    }

    fun release() {
        connectionJob?.cancel()
        snapshotJob?.cancel()
        remote?.setSessionAvailabilityListener(null)
        remote?.release() // Detaches the sender without stopping receiver playback.
        remote = null
    }
}
