package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.ui.library.sortThemesByType
import org.junit.Assert.assertEquals
import org.junit.Test

class ThemeSortOrderTest {

    private fun theme(id: Long, themeType: String?, title: String = "Song $id") = ThemeEntity(
        id = id,
        animeId = null,
        title = title,
        artistName = null,
        audioUrl = "https://example.com/$id.mp3",
        videoUrl = null,
        isDownloaded = false,
        localFilePath = null,
        themeType = themeType
    )

    @Test
    fun `OP1 comes before ED1`() {
        val input = listOf(theme(1, "ED1"), theme(2, "OP1"))
        val sorted = sortThemesByType(input)
        assertEquals(listOf("OP1", "ED1"), sorted.map { it.themeType })
    }

    @Test
    fun `interleaved order OP1 ED1 OP2 ED2`() {
        val input = listOf(
            theme(1, "ED2"),
            theme(2, "OP2"),
            theme(3, "ED1"),
            theme(4, "OP1")
        )
        val sorted = sortThemesByType(input)
        assertEquals(listOf("OP1", "ED1", "OP2", "ED2"), sorted.map { it.themeType })
    }

    @Test
    fun `higher numbers come after lower numbers`() {
        val input = listOf(
            theme(1, "OP3"),
            theme(2, "OP1"),
            theme(3, "OP2")
        )
        val sorted = sortThemesByType(input)
        assertEquals(listOf("OP1", "OP2", "OP3"), sorted.map { it.themeType })
    }

    @Test
    fun `themes without type sort to end`() {
        val input = listOf(
            theme(1, null, "Bonus Track"),
            theme(2, "OP1"),
            theme(3, "ED1")
        )
        val sorted = sortThemesByType(input)
        assertEquals("OP1", sorted[0].themeType)
        assertEquals("ED1", sorted[1].themeType)
        assertEquals(null, sorted[2].themeType)
    }

    @Test
    fun `themes without type are sorted by title among themselves`() {
        val input = listOf(
            theme(1, null, "Zzz"),
            theme(2, null, "Aaa"),
            theme(3, "OP1")
        )
        val sorted = sortThemesByType(input)
        assertEquals("OP1", sorted[0].themeType)
        assertEquals("Aaa", sorted[1].title)
        assertEquals("Zzz", sorted[2].title)
    }

    @Test
    fun `empty list returns empty list`() {
        assertEquals(emptyList<ThemeEntity>(), sortThemesByType(emptyList()))
    }

    @Test
    fun `single theme returns same list`() {
        val input = listOf(theme(1, "OP1"))
        assertEquals(input, sortThemesByType(input))
    }

    @Test
    fun `case insensitive matching for op and ed`() {
        val input = listOf(
            theme(1, "ed1"),
            theme(2, "op1")
        )
        val sorted = sortThemesByType(input)
        assertEquals("op1", sorted[0].themeType)
        assertEquals("ed1", sorted[1].themeType)
    }

    @Test
    fun `large sequence stays in correct order`() {
        val input = listOf(
            theme(1, "ED5"), theme(2, "OP5"),
            theme(3, "ED1"), theme(4, "OP1"),
            theme(5, "ED3"), theme(6, "OP3")
        )
        val sorted = sortThemesByType(input)
        assertEquals(
            listOf("OP1", "ED1", "OP3", "ED3", "OP5", "ED5"),
            sorted.map { it.themeType }
        )
    }
}
