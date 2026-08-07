package com.takeya.animeongaku

import com.takeya.animeongaku.ui.search.parseServerThemeId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerThemeIdParserTest {
    @Test
    fun `numeric server theme id is preserved exactly`() {
        assertEquals(9_223_372_036_854_775_807L, parseServerThemeId("9223372036854775807"))
    }

    @Test
    fun `invalid server theme ids are skipped instead of being hashed into Room ids`() {
        assertNull(parseServerThemeId("not-a-number"))
        assertNull(parseServerThemeId("9223372036854775808"))
        assertNull(parseServerThemeId("-1"))
    }
}
