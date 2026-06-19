package com.takeya.animeongaku

import com.takeya.animeongaku.data.auth.ServerSession
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.auth.SessionStateManager
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.NowPlayingManager
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

    private fun manager(active: Boolean): NowPlayingManager {
        val tokenStore = ServerTokenStore(FakeSharedPreferences()).apply {
            save(ServerSession("tok", "uid", "n"))
        }
        val state = SessionStateManager(tokenStore)
        if (!active) state.markUnauthorized()
        return NowPlayingManager(state)
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
}
