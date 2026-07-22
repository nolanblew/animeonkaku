package com.takeya.animeongaku

import com.takeya.animeongaku.ui.library.RelatedMusicBodyState
import com.takeya.animeongaku.ui.library.relatedMusicBodyState
import com.takeya.animeongaku.ui.library.relatedReleaseArtworkUrls
import com.takeya.animeongaku.ui.library.relatedMusicRefreshMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RelatedMusicPresentationTest {
    @Test
    fun `initial refresh does not show empty state`() {
        assertEquals(RelatedMusicBodyState.Loading, relatedMusicBodyState(isRefreshing = true, hasContent = false, hasError = false))
    }

    @Test
    fun `empty failure gives retry copy`() {
        assertEquals(RelatedMusicBodyState.LoadFailed, relatedMusicBodyState(isRefreshing = false, hasContent = false, hasError = true))
    }

    @Test
    fun `saved content failure alone gives saved music copy`() {
        assertEquals("Couldn’t refresh. Showing saved music.", relatedMusicRefreshMessage(hasContent = true, hasError = true))
        assertNull(relatedMusicRefreshMessage(hasContent = false, hasError = true))
    }

    @Test
    fun `release artwork falls back to the owning anime artwork`() {
        assertEquals(
            listOf("https://anime.example/cover.jpg"),
            relatedReleaseArtworkUrls(null, null, listOf("https://anime.example/cover.jpg"))
        )
    }

    @Test
    fun `release artwork keeps release and owner artwork ahead of anime fallback`() {
        assertEquals(
            listOf("release", "owner", "anime"),
            relatedReleaseArtworkUrls("release", "owner", listOf("anime", "owner"))
        )
    }
}
