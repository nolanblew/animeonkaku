package com.takeya.animeongaku

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.ThumbRating
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionResult
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.takeya.animeongaku.media.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(UnstableApi::class)
class SystemReactionMediaSessionCallbackTest {
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaSession
    private lateinit var controller: MediaController

    @Test
    fun controllerReceivesStatefulReactionsAndDoesNotMovePlayer() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val target = SystemReactionTarget(7L, PlayableKey(PlayableKind.THEME, 100L))
        var persisted = SystemReaction.DISLIKE
        var writes = 0
        var layoutState = SystemReaction.NONE
        var discontinuities = 0
        var stateChanges = 0
        try {
            onMain {
                player = ExoPlayer.Builder(context).build()
                player.setMediaItems(listOf("7", "8").map {
                    MediaItem.Builder().setMediaId(it).setUri("file:///dev/null").build()
                }, 0, 5_000L)
                player.addListener(object : Player.Listener {
                    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) { discontinuities++ }
                    override fun onPlaybackStateChanged(playbackState: Int) { stateChanges++ }
                })
                val callback = SystemReactionMediaSessionCallback(
                    currentTarget = { target.takeIf { player.currentMediaItem?.mediaId == it.queueId.toString() } },
                    submitReaction = { submittedTarget, reaction ->
                        assertEquals(target, submittedTarget)
                        if (persisted != reaction) { persisted = reaction; writes++ }
                        layoutState = reaction
                        session.setCustomLayout(SystemReactionSessionCommands.layout(reaction, enabled = true))
                        completed()
                    },
                    currentLayout = { SystemReactionSessionCommands.layout(layoutState, enabled = true) }
                )
                session = MediaSession.Builder(context, player).setId("system-reaction-protocol-test").setCallback(callback)
                    .setCustomLayout(SystemReactionSessionCommands.layout(SystemReaction.NONE, enabled = true)).build()
                // Connecting later must receive the current state, not the initial builder layout.
                layoutState = SystemReaction.DISLIKE
            }
            controller = onMain { MediaController.Builder(context, session.token).buildAsync() }.get(10, TimeUnit.SECONDS)
            onMain {
                assertTrue(controller.availableSessionCommands.contains(SystemReactionSessionCommands.like))
                assertTrue(controller.availableSessionCommands.contains(SystemReactionSessionCommands.dislike))
                assertTrue(controller.availableSessionCommands.contains(SystemReactionSessionCommands.clear))
                val layout = controller.customLayout
                assertEquals(2, layout.size)
                assertEquals("Like", layout[0].displayName.toString())
                assertEquals("Remove dislike", layout[1].displayName.toString())
                assertEquals(SystemReactionSessionCommands.LIKE_ACTION, layout[0].sessionCommand?.customAction)
                assertEquals(SystemReactionSessionCommands.CLEAR_ACTION, layout[1].sessionCommand?.customAction)
                assertEquals(R.drawable.ic_thumb_down_filled, layout[1].iconResId)
            }
            repeat(2) { command { controller.setRating("7", ThumbRating(true)) } }
            onMain { assertEquals(SystemReaction.LIKE, persisted); assertEquals(1, writes) }
            assertEquals(SessionResult.RESULT_ERROR_INVALID_STATE, command { controller.setRating("8", ThumbRating(false)) }.resultCode)
            onMain { assertEquals(1, writes) }
            command { controller.sendCustomCommand(SystemReactionSessionCommands.clear, Bundle()) }
            onMain { assertEquals(SystemReaction.NONE, persisted) }
            command { controller.sendCustomCommand(SystemReactionSessionCommands.like, Bundle()) }
            onMain { assertEquals(SystemReaction.LIKE, persisted) }
            command { controller.sendCustomCommand(SystemReactionSessionCommands.dislike, Bundle()) }
            onMain {
                assertEquals(SystemReaction.DISLIKE, persisted)
                assertEquals(4, writes)
                // The protocol only writes preferences. The production preference observer owns skipping.
                assertEquals("7", player.currentMediaItem?.mediaId)
                assertEquals(0, player.currentMediaItemIndex)
                assertEquals(5_000L, player.currentPosition)
                assertEquals(Player.STATE_IDLE, player.playbackState)
                assertFalse(player.playWhenReady)
                assertEquals(0, discontinuities)
                assertEquals(0, stateChanges)
            }
        } finally {
            onMain {
                if (::controller.isInitialized) controller.release()
                if (::session.isInitialized) session.release()
                if (::player.isInitialized) player.release()
            }
        }
    }

    private fun command(action: () -> ListenableFuture<SessionResult>): SessionResult = onMain(action).get(5, TimeUnit.SECONDS)
    private fun completed(): ListenableFuture<SessionResult> = SettableFuture.create<SessionResult>().also { it.set(SessionResult(SessionResult.RESULT_SUCCESS)) }
    private fun <T> onMain(action: () -> T): T {
        var result: Result<T>? = null
        InstrumentationRegistry.getInstrumentation().runOnMainSync { result = runCatching(action) }
        return requireNotNull(result).getOrThrow()
    }
}
