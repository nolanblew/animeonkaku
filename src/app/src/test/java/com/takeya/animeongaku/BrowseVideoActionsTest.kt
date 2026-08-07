package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.media.PlaybackResolver
import com.takeya.animeongaku.media.playVideoContext
import com.takeya.animeongaku.ui.common.BrowseVideoActionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

class BrowseVideoActionsTest {
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
    fun `single and context menu availability requires online usable video`() {
        val video = mode(1, "https://v.animethemes.moe/theme.webm")
        val blankVideo = mode(2, "   ")

        assertTrue(BrowseVideoActionPolicy.singleTheme(isOnline = true, video))
        assertFalse(BrowseVideoActionPolicy.singleTheme(isOnline = false, video))
        assertFalse(BrowseVideoActionPolicy.singleTheme(isOnline = true, null))
        assertFalse(BrowseVideoActionPolicy.singleTheme(isOnline = true, blankVideo))
        assertTrue(BrowseVideoActionPolicy.context(isOnline = true, listOf(blankVideo, video)))
        assertFalse(BrowseVideoActionPolicy.context(isOnline = false, listOf(video)))
        assertFalse(BrowseVideoActionPolicy.context(isOnline = true, listOf(blankVideo)))
    }

    @Test
    fun `Play Video replaces context and keeps Video preference across fallback entries`() {
        val first = theme(1)
        val second = theme(2)
        manager.playVideoContext(
            contextLabel = "Anime",
            themes = listOf(first, second, second),
            modesByThemeId = mapOf(
                first.id to mode(first.id, null),
                second.id to mode(second.id, "https://v.animethemes.moe/second.webm")
            )
        )

        val state = manager.state.value
        assertEquals(PlaybackMode.VIDEO, state.playbackIntent.sessionOverride)
        assertEquals(3, state.nowPlayingEntries.map { it.queueId }.distinct().size)
        assertEquals(listOf(1L, 2L, 2L), state.nowPlayingEntries.map { it.theme.id })

        val resolver = PlaybackResolver()
        val firstResolved = resolver.resolve(state.nowPlayingEntries[0], state.playbackIntent, true, emptyMap())
        val secondResolved = resolver.resolve(state.nowPlayingEntries[1], state.playbackIntent, true, emptyMap())
        assertEquals(PlaybackMode.VIDEO, firstResolved.preferredMode)
        assertEquals(PlaybackMode.TV_SIZE, firstResolved.actualMode)
        assertEquals(PlaybackMode.VIDEO, secondResolved.preferredMode)
        assertEquals(PlaybackMode.VIDEO, secondResolved.actualMode)
    }

    @Test
    fun `Play Video single theme discards the prior queue occurrence`() {
        val requested = theme(7)
        manager.play("Old", listOf(theme(1), requested))
        val oldIds = manager.state.value.nowPlayingEntries.map { it.queueId }.toSet()

        manager.playVideoContext(
            contextLabel = "Theme",
            themes = listOf(requested),
            modesByThemeId = mapOf(requested.id to mode(requested.id, "https://v.animethemes.moe/7.webm"))
        )

        val state = manager.state.value
        assertEquals(listOf(7L), state.nowPlayingEntries.map { it.theme.id })
        assertTrue(state.nowPlayingEntries.single().queueId !in oldIds)
        assertEquals(PlaybackMode.VIDEO, state.playbackIntent.sessionOverride)
    }

    @Test
    fun `request warns up front for marked videos later in a fallback context`() {
        val first = theme(1)
        val spoiler = theme(2)
        val request = BrowseVideoActionPolicy.request(
            true, "Anime", listOf(first, spoiler),
            mapOf(first.id to mode(first.id, null), spoiler.id to mode(spoiler.id, "https://video/2", spoiler = true))
        )

        assertNotNull(request)
        assertTrue(request!!.warning!!.spoiler)
        assertFalse(request.warning!!.nsfw)
    }

    @Test
    fun `request without marked video starts only while online snapshot is unchanged`() {
        val requested = theme(3)
        val modes = mapOf(requested.id to mode(requested.id, "https://video/3"))
        val request = BrowseVideoActionPolicy.request(true, "Theme", listOf(requested), modes)!!
        assertNull(request.warning)

        manager.play("Old", listOf(theme(9)))
        assertFalse(request.startIfStillValid(manager, false, listOf(requested), modes))
        assertEquals(listOf(9L), manager.state.value.nowPlayingEntries.map { it.theme.id })
        assertFalse(request.startIfStillValid(manager, true, listOf(requested.copy(title = "Changed")), modes))
        assertFalse(request.startIfStillValid(manager, true, listOf(requested), emptyMap()))
        assertFalse(request.startIfStillValid(manager, true, listOf(requested), modes, "Changed context"))
        assertTrue(request.startIfStillValid(manager, true, listOf(requested), modes))
        assertEquals(listOf(3L), manager.state.value.nowPlayingEntries.map { it.theme.id })
    }

    private fun theme(id: Long) = ThemeEntity(
        id = id,
        animeId = 10,
        title = "Theme $id",
        artistName = null,
        audioUrl = "https://server/theme/$id",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null
    )

    private fun mode(id: Long, videoUrl: String?, spoiler: Boolean = false, nsfw: Boolean = false) = ThemeModeEntity(
        themeId = id,
        tvSizeUrl = "https://server/theme/$id",
        videoUrl = videoUrl,
        videoSpoiler = spoiler,
        videoNsfw = nsfw
    )
}
