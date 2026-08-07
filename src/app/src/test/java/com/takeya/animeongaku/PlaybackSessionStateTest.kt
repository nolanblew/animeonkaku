package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.ThemeModePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test

class PlaybackSessionStateTest {
    private lateinit var manager: NowPlayingManager

    @Before
    fun setUp() {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "name"))
        }
        manager = NowPlayingManager(
            SessionStateManager(tokenStore),
            PlaybackPreferences(FakeSharedPreferences())
        )
    }

    @Test
    fun `manual mode applies to subsequent items without changing queue identity`() {
        val policy = BaseModePolicy(ThemeModePolicy.TV_SIZE, PlaybackMode.FULL_SIZE)
        manager.playItems(
            "Context",
            listOf(PlayableItem.Theme(theme(1)), PlayableItem.Theme(theme(2))),
            baseModePolicy = policy
        )
        val queueIds = manager.state.value.nowPlayingEntries.map { it.queueId }

        manager.selectThemeMode(PlaybackMode.FULL_SIZE)

        assertEquals(PlaybackMode.FULL_SIZE, manager.state.value.playbackIntent.sessionOverride)
        assertEquals(queueIds, manager.state.value.nowPlayingEntries.map { it.queueId })
        assertEquals(listOf(policy, policy), manager.state.value.nowPlayingEntries.map { it.baseModePolicy })
    }

    @Test
    fun `queue replacement clears manual Video unless context explicitly starts Video`() {
        manager.playItems("First", listOf(PlayableItem.Theme(theme(1))))
        manager.selectThemeMode(PlaybackMode.VIDEO)

        manager.playItems("Replacement", listOf(PlayableItem.Theme(theme(2))))
        assertNull(manager.state.value.playbackIntent.sessionOverride)

        manager.playItems(
            "Play Video",
            listOf(PlayableItem.Theme(theme(3))),
            initialSessionMode = PlaybackMode.VIDEO
        )
        assertEquals(PlaybackMode.VIDEO, manager.state.value.playbackIntent.sessionOverride)
    }

    @Test
    fun `queue replacement clears Video but preserves remembered Full Size`() {
        val preferences = PlaybackPreferences(FakeSharedPreferences())
        manager = NowPlayingManager(managerSession(), preferences)
        manager.selectThemeMode(PlaybackMode.FULL_SIZE)
        manager.playItems("First", listOf(PlayableItem.Theme(theme(1))))
        manager.selectThemeMode(PlaybackMode.VIDEO)

        manager.playItems("Replacement", listOf(PlayableItem.Theme(theme(2))))

        assertEquals(PlaybackMode.FULL_SIZE, manager.state.value.playbackIntent.rememberedAudioMode)
        assertNull(manager.state.value.playbackIntent.sessionOverride)
    }

    @Test
    fun `authoritative selection resolves Full immediately and after reconstruction`() {
        val storage = FakeSharedPreferences()
        val firstPreferences = PlaybackPreferences(storage)
        val firstManager = newManager(firstPreferences)
        val playable = PlayableItem.Theme(
            theme(1),
            modeDescriptor = ThemeModeEntity(
                themeId = 1,
                tvSizeUrl = "https://server/1",
                fullSizeSongId = 10,
                fullSizeUrl = "https://server/song/10"
            )
        )
        firstManager.playItems("First", listOf(playable))

        firstManager.selectThemeMode(PlaybackMode.FULL_SIZE)

        assertEquals(PlaybackMode.FULL_SIZE, firstPreferences.rememberedAudioMode)
        assertEquals(PlaybackMode.FULL_SIZE, firstManager.state.value.playbackIntent.rememberedAudioMode)
        assertEquals(PlaybackMode.FULL_SIZE, firstManager.state.value.playbackIntent.sessionOverride)
        assertEquals(
            PlaybackMode.FULL_SIZE,
            PlaybackResolver().resolve(
                firstManager.state.value.currentEntry!!,
                firstManager.state.value.playbackIntent,
                isOnline = true,
                localMedia = emptyMap()
            ).actualMode
        )

        val restartedPreferences = PlaybackPreferences(storage)
        val restartedManager = newManager(restartedPreferences)
        restartedManager.playItems("Restarted", listOf(playable))

        assertEquals(PlaybackMode.FULL_SIZE, restartedManager.state.value.playbackIntent.rememberedAudioMode)
        assertNull(restartedManager.state.value.playbackIntent.sessionOverride)
        assertEquals(
            PlaybackMode.FULL_SIZE,
            PlaybackResolver().resolve(
                restartedManager.state.value.currentEntry!!,
                restartedManager.state.value.playbackIntent,
                isOnline = true,
                localMedia = emptyMap()
            ).actualMode
        )
    }

    @Test
    fun `Related Audio cannot enter Theme session state`() {
        assertThrows(IllegalArgumentException::class.java) {
            manager.selectThemeMode(PlaybackMode.RELATED_AUDIO)
        }
        assertThrows(IllegalArgumentException::class.java) {
            manager.playItems(
                "Invalid",
                listOf(PlayableItem.Theme(theme(1))),
                initialSessionMode = PlaybackMode.RELATED_AUDIO
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            PlaybackIntent(sessionOverride = PlaybackMode.RELATED_AUDIO)
        }
    }

    private fun newManager(
        preferences: PlaybackPreferences = PlaybackPreferences(FakeSharedPreferences())
    ): NowPlayingManager = NowPlayingManager(managerSession(), preferences)

    private fun managerSession(): SessionStateManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "name"))
        }
        return SessionStateManager(tokenStore)
    }

    private fun theme(id: Long) = ThemeEntity(
        id, null, "Theme $id", null, "https://server/$id", null, false, null
    )
}
