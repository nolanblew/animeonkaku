package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.library.preserveMaterializedPlaylistOrder
import org.junit.Assert.assertEquals
import org.junit.Test

class PlaylistDetailOrderingTest {
    @Test
    fun `materialized auto playlists retain persisted order instead of title order`() {
        val persisted = listOf(
            track(id = 1L, orderIndex = 0, title = "Zeta opening"),
            track(id = 2L, orderIndex = 1, title = "Alpha opening"),
            track(id = 3L, orderIndex = 2, title = "Beta ending")
        )

        assertEquals(listOf(1L, 2L, 3L),
            preserveMaterializedPlaylistOrder(persisted).map { it.theme.id })
    }

    private fun track(id: Long, orderIndex: Int, title: String) = PlaylistTrack(
        theme = ThemeEntity(
            id = id,
            animeId = id,
            title = title,
            artistName = null,
            audioUrl = "https://example.com/$id.mp3",
            videoUrl = null,
            isDownloaded = false,
            localFilePath = null
        ),
        orderIndex = orderIndex
    )
}
