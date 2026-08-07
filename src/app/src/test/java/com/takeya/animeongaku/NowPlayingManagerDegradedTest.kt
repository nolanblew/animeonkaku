package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.media.BaseModePolicy
import com.takeya.animeongaku.media.MediaKey
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.OfflineMediaAvailability
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackPreferences
import com.takeya.animeongaku.media.ThemeModePolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class NowPlayingManagerDegradedTest {

    private fun theme(id: Long, downloaded: Boolean) = ThemeEntity(
        id = id,
        animeId = null,
        title = "t$id",
        artistName = null,
        audioUrl = "https://server/v1/media/audio/$id",
        videoUrl = null,
        isDownloaded = downloaded,
        localFilePath = if (downloaded) "/data/$id.mp3" else null,
        themeType = "OP"
    )

    private fun manager(active: Boolean, availableKeys: Set<MediaKey> = emptySet()): NowPlayingManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val state = SessionStateManager(tokenStore)
        if (!active) state.markUnauthorized()
        return NowPlayingManager(
            state,
            PlaybackPreferences(FakeSharedPreferences()),
            OfflineMediaAvailability(availableKeys)
        )
    }

    @Test
    fun `active mode plays all themes`() {
        val npm = manager(active = true)
        npm.play("ctx", listOf(theme(1, false), theme(2, false)), startIndex = 0)
        assertEquals(2, npm.state.value.nowPlayingEntries.size)
    }

    @Test
    fun `degraded mode keeps only downloaded themes`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, false), theme(2, true), theme(3, false)), startIndex = 0)
        val ids = npm.state.value.nowPlayingEntries.map { it.theme.id }
        assertEquals(listOf(2L), ids)
    }

    @Test
    fun `degraded mode starts at selected downloaded theme after filtering`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, false), theme(2, true), theme(3, true)), startIndex = 1)
        val ids = npm.state.value.nowPlayingEntries.map { it.theme.id }
        assertEquals(listOf(2L, 3L), ids)
        assertEquals(2L, npm.state.value.currentTheme?.id)
    }

    @Test
    fun `playNext in degraded mode inserts only downloaded themes`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, true)), startIndex = 0)
        npm.playNext(listOf(theme(2, false), theme(3, true)))
        val ids = npm.state.value.nowPlayingEntries.map { it.theme.id }
        assertEquals(listOf(1L, 3L), ids)
    }

    @Test
    fun `addToQueue in degraded mode appends only downloaded themes`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, true)), startIndex = 0)
        npm.addToQueue(listOf(theme(2, false), theme(3, true)))
        val ids = npm.state.value.nowPlayingEntries.map { it.theme.id }
        assertEquals(listOf(1L, 3L), ids)
    }

    @Test
    fun `degraded mode with no downloads is a no-op`() {
        val npm = manager(active = false)
        npm.play("ctx", listOf(theme(1, false)), startIndex = 0)
        assertEquals(0, npm.state.value.nowPlayingEntries.size)
    }

    @Test
    fun `offline TV file never satisfies Full Size requirement`() {
        val npm = manager(active = false, availableKeys = setOf(MediaKey.themeTv(1)))
        val fullTheme = PlayableItem.Theme(
            theme(1, downloaded = true),
            modeDescriptor = ThemeModeEntity(
                themeId = 1,
                tvSizeUrl = "/tv/1",
                fullSizeSongId = 99,
                fullSizeUrl = "/songs/99"
            )
        )

        npm.playItems(
            "Full playlist",
            listOf(fullTheme),
            baseModePolicy = BaseModePolicy.Inherit,
            initialSessionMode = PlaybackMode.FULL_SIZE
        )

        assertEquals(0, npm.state.value.nowPlayingEntries.size)
    }

    @Test
    fun `offline missing Related Song is not admitted`() {
        val npm = manager(active = false)
        val song = PlayableItem.RelatedSong(SongEntity(77, "Song", "Artist", audioUrl = "/songs/77"))

        npm.playItems("Related", listOf(song))

        assertEquals(0, npm.state.value.nowPlayingEntries.size)
    }
}
