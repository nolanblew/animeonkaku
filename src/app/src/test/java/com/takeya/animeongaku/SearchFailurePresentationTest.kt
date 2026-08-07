package com.takeya.animeongaku

import com.takeya.animeongaku.ui.search.searchFailureMessage
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchFailurePresentationTest {
    @Test
    fun `remote failure with cached results preserves friendly saved result copy`() {
        assertEquals("Couldn’t refresh. Showing saved results.", searchFailureMessage(hasCachedResults = true))
    }

    @Test
    fun `remote failure without cached results offers retry without exception details`() {
        assertEquals("Couldn’t search right now. Try again.", searchFailureMessage(hasCachedResults = false))
    }
}
