package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.repository.shouldApplyDynamicRefresh
import com.takeya.animeongaku.ui.dynamic.dynamicPlaylistSavePresentation
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DynamicPlaylistRepositoryTest {
    @Test
    fun `dynamic preview saves edits in place instead of creating a playlist`() {
        val creating = dynamicPlaylistSavePresentation(editingPlaylistId = null, isSaving = false)
        val editing = dynamicPlaylistSavePresentation(editingPlaylistId = 77L, isSaving = false)

        assertEquals("New Smart Playlist", creating.title)
        assertEquals("Create Playlist", creating.buttonLabel)
        assertEquals("Edit Smart Playlist", editing.title)
        assertEquals("Save Changes", editing.buttonLabel)

        val source = File("src/main/java/com/takeya/animeongaku/ui/dynamic/DynamicPreviewScreen.kt").readText()
        assertTrue(source.contains("viewModel.saveCurrentPlaylist()"))
        assertFalse(source.contains("viewModel.savePlaylist()"))
    }

    @Test
    fun `local dynamic refresh is skipped after a fresher server pull or server managed spec`() {
        val startedAt = 100L
        val latestLocalPlaylist = PlaylistEntity(
            id = 77L,
            name = "Smart",
            createdAt = 1L,
            updatedAt = startedAt
        )
        val fresherServerPlaylist = latestLocalPlaylist.copy(updatedAt = 200L)
        val localSpec = spec(serverManaged = false)
        val serverSpec = spec(serverManaged = true)

        assertTrue(shouldApplyDynamicRefresh(startedAt, latestLocalPlaylist, localSpec))
        assertFalse(shouldApplyDynamicRefresh(startedAt, fresherServerPlaylist, localSpec))
        assertFalse(shouldApplyDynamicRefresh(startedAt, latestLocalPlaylist, serverSpec))
    }

    private fun spec(serverManaged: Boolean): DynamicPlaylistSpecEntity =
        DynamicPlaylistSpecEntity(
            playlistId = 77L,
            filterJson = """{"type":"liked"}""",
            mode = "AUTO",
            createdMode = "SIMPLE",
            serverManaged = serverManaged
        )
}
