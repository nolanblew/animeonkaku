package com.takeya.animeongaku

import com.takeya.animeongaku.ui.library.LibraryGridKind
import com.takeya.animeongaku.ui.library.libraryGridColumns
import com.takeya.animeongaku.ui.library.libraryGridBottomClearanceDp
import com.takeya.animeongaku.ui.library.libraryPosterAspectRatio
import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryGridPolicyTest {
    @Test
    fun `compact phones show two playlists and three anime posters per row`() {
        assertEquals(2, libraryGridColumns(360, LibraryGridKind.PLAYLISTS))
        assertEquals(3, libraryGridColumns(360, LibraryGridKind.ANIME))
        assertEquals(2, libraryGridColumns(411, LibraryGridKind.PLAYLISTS))
        assertEquals(3, libraryGridColumns(411, LibraryGridKind.ANIME))
    }

    @Test
    fun `library grids add columns at medium and expanded widths`() {
        assertEquals(3, libraryGridColumns(600, LibraryGridKind.PLAYLISTS))
        assertEquals(4, libraryGridColumns(600, LibraryGridKind.ANIME))
        assertEquals(4, libraryGridColumns(840, LibraryGridKind.PLAYLISTS))
        assertEquals(6, libraryGridColumns(840, LibraryGridKind.ANIME))
    }

    @Test
    fun `anime artwork uses a portrait poster ratio`() {
        assertEquals(2f / 3f, libraryPosterAspectRatio(), 0.001f)
    }

    @Test
    fun `library grids clear the overlaid mini player`() {
        assertEquals(90, libraryGridBottomClearanceDp())
    }
}
