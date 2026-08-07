package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.repository.shouldApplyDynamicRefresh
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DynamicPlaylistRepositoryTest {
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
