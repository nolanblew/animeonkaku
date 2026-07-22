package com.takeya.animeongaku

import com.takeya.animeongaku.ui.library.RelatedMusicBodyState
import com.takeya.animeongaku.ui.library.relatedMusicBodyState
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
}
