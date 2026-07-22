package com.takeya.animeongaku

import com.takeya.animeongaku.sync.legacyPlaylistEntryId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PlaylistEntryIdentityTest {
    @Test
    fun `legacy duplicate occurrences receive stable distinct identities`() {
        val first = legacyPlaylistEntryId(themeId = 77L, occurrence = 0)
        val duplicate = legacyPlaylistEntryId(themeId = 77L, occurrence = 1)
        val otherTheme = legacyPlaylistEntryId(themeId = 78L, occurrence = 0)

        assertNotEquals(first, duplicate)
        assertNotEquals(first, otherTheme)
        assertEquals(first, legacyPlaylistEntryId(themeId = 77L, occurrence = 0))
    }
}
