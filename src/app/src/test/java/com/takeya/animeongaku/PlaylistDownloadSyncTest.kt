package com.takeya.animeongaku

import com.takeya.animeongaku.download.newPlaylistDownloadThemeIds
import com.takeya.animeongaku.download.playlistDownloadRefreshes
import com.takeya.animeongaku.data.local.DownloadGroupEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaylistDownloadSyncTest {
    @Test
    fun `downloaded playlist refreshes when its preferred version changes`() = runTest {
        val playlist = MutableStateFlow(PlaylistEntity(7, "Drive", 1, defaultMode = "TV_SIZE"))
        val entries = MutableStateFlow(listOf(PlaylistEntryEntity(
            playlistId = 7,
            themeId = 10,
            orderIndex = 0,
            entryId = 1,
            itemType = "THEME",
            itemId = 10
        )))
        val group = DownloadGroupEntity(3, DownloadGroupEntity.TYPE_PLAYLIST, "7", "Drive")

        val emissions = async {
            playlistDownloadRefreshes(group, playlist, entries).take(2).toList()
        }
        advanceUntilIdle()
        playlist.value = playlist.value.copy(defaultMode = "FULL_SIZE", updatedAt = 2)
        advanceUntilIdle()

        assertEquals(listOf(7L, 7L), emissions.await())
    }

    @Test
    fun `downloaded playlist refreshes when preference override changes`() = runTest {
        val playlist = MutableStateFlow(PlaylistEntity(7, "Drive", 1, overrideUserPreference = false))
        val entries = MutableStateFlow(listOf(PlaylistEntryEntity(
            playlistId = 7,
            themeId = 10,
            orderIndex = 0,
            entryId = 1,
            itemType = "THEME",
            itemId = 10
        )))
        val group = DownloadGroupEntity(3, DownloadGroupEntity.TYPE_PLAYLIST, "7", "Drive")

        val emissions = async { playlistDownloadRefreshes(group, playlist, entries).take(2).toList() }
        advanceUntilIdle()
        playlist.value = playlist.value.copy(overrideUserPreference = true, updatedAt = 2)
        advanceUntilIdle()

        assertEquals(listOf(7L, 7L), emissions.await())
    }

    @Test
    fun `themes added to a downloaded playlist are returned for download`() {
        assertEquals(
            listOf(30L, 40L),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 20L, 30L, 40L),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }

    @Test
    fun `nothing new when the playlist is unchanged`() {
        assertEquals(
            emptyList<Long>(),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 20L),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }

    @Test
    fun `duplicate playlist entries are only downloaded once`() {
        assertEquals(
            listOf(30L),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = listOf(10L, 30L, 30L),
                trackedThemeIds = setOf(10L)
            )
        )
    }

    @Test
    fun `removed tracks are not re-downloaded and an empty playlist adds nothing`() {
        // Tracks that left the playlist but remain tracked are simply ignored (no additions).
        assertEquals(
            emptyList<Long>(),
            newPlaylistDownloadThemeIds(
                playlistThemeIds = emptyList(),
                trackedThemeIds = setOf(10L, 20L)
            )
        )
    }
}
