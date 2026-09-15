package com.takeya.animeongaku

import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.takeya.animeongaku.media.*
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the replacement policy against real ExoPlayer with a local, generated silent WAV. */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackSourceContinuityTest {
    @Test fun passiveRefreshPreservesPlayingSourceAndExplicitModeChangeRestarts() = verifyContinuity(true)
    @Test fun passiveRefreshPreservesPausedSourceAndExplicitModeChangeStaysPaused() = verifyContinuity(false)

    private fun verifyContinuity(playing: Boolean) {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val audio = File.createTempFile("ongaku-continuity", ".wav", context.cacheDir)
        writeSilence(audio)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val ready = CountDownLatch(1)
        lateinit var player: ExoPlayer
        var playerCreated = false
        lateinit var adapter: RealController
        val original = listOf(descriptor(1, audio), descriptor(2, audio))
        try {
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).build()
                playerCreated = true
                player.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        if (playbackState == Player.STATE_READY) ready.countDown()
                    }
                })
                adapter = RealController(player, original)
                player.setMediaItems(original.map(::mediaItem), 0, 5_000L)
                player.playWhenReady = playing
                player.prepare()
            }
            assertTrue("Local audio must become ready", ready.await(15, TimeUnit.SECONDS))
            instrumentation.runOnMainSync {
                val before = player.currentPosition
                assertTrue(before >= 5_000L)
                val refreshed = original.map { it.copy(title = "Updated", tag = it.tag.copy(actualMode = PlaybackMode.FULL_SIZE)) }
                // Immediate preference write followed by metadata/server reconciliation.
                repeat(2) { replaceModeChangedPlaybackItems(adapter, refreshed, preserveCurrent = true) }
                assertEquals("1", player.currentMediaItem?.mediaId)
                assertTrue("Passive refresh must not rewind", player.currentPosition >= before)
                assertEquals(playing, player.playWhenReady)
                assertEquals(listOf(1), adapter.replaced)
                assertEquals(0, adapter.prepareCalls)
                assertEquals(0, adapter.seekCalls)

                replaceModeChangedPlaybackItems(adapter, refreshed)
                assertEquals(listOf(1, 0), adapter.replaced)
                assertEquals(1, adapter.seekCalls)
                assertEquals(1, adapter.prepareCalls)
                assertTrue("Explicit Full Size selection starts at zero", player.currentPosition < 1_000L)
                assertEquals(playing, player.playWhenReady)
            }
        } finally {
            if (playerCreated) instrumentation.runOnMainSync { player.release() }
            audio.delete()
        }
    }

    private class RealController(val player: ExoPlayer, initial: List<PlaybackMediaDescriptor>) : PlaybackItemController {
        override val items = initial.toMutableList()
        val replaced = mutableListOf<Int>()
        var seekCalls = 0
        var prepareCalls = 0
        override var currentIndex: Int
            get() = player.currentMediaItemIndex
            set(value) { player.seekTo(value, player.currentPosition) }
        override var playWhenReady: Boolean
            get() = player.playWhenReady
            set(value) { player.playWhenReady = value }
        override fun replaceMediaItem(index: Int, item: PlaybackMediaDescriptor) {
            replaced += index
            items[index] = item
            player.replaceMediaItem(index, mediaItem(item))
        }
        override fun seekTo(index: Int, positionMs: Long) { seekCalls++; player.seekTo(index, positionMs) }
        override fun prepare() { prepareCalls++; player.prepare() }
    }

    private fun descriptor(id: Long, audio: File) = ResolvedPlaybackItem(
        queueId = id, playableKey = PlayableKey(PlayableKind.THEME, 10), preferredMode = PlaybackMode.TV_SIZE,
        actualMode = PlaybackMode.TV_SIZE, uri = audio.toURI().toString(), mediaKey = MediaKey.themeTv(10),
        source = PlaybackSource.LOCAL, availableModes = setOf(PlaybackMode.TV_SIZE), retainedIntentReason = null,
        title = "Song", artist = null, animeOrRelease = null, artworkUrl = null
    ).toPlaybackMediaDescriptor()

    private fun writeSilence(file: File) {
        val bytes = 8_000 * 2 * 30
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVEfmt ".toByteArray())
        header.putInt(16).putShort(1).putShort(1).putInt(8_000).putInt(16_000).putShort(2).putShort(16)
        header.put("data".toByteArray()).putInt(bytes)
        file.outputStream().use { it.write(header.array()); it.write(ByteArray(bytes)) }
    }

    companion object {
        private fun mediaItem(item: PlaybackMediaDescriptor) = MediaItem.Builder()
            .setMediaId(item.mediaId).setUri(item.uri).build()
    }
}
