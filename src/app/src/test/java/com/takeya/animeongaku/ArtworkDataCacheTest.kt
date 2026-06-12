package com.takeya.animeongaku

import com.takeya.animeongaku.media.ArtworkDataCache
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ArtworkDataCacheTest {

    @Test
    fun `get returns a defensive copy`() {
        val cache = ArtworkDataCache()
        val original = byteArrayOf(1, 2, 3)

        cache.put("cover", original)
        original[0] = 9
        val fromCache = cache.get("cover")!!
        fromCache[1] = 8

        assertArrayEquals(byteArrayOf(1, 2, 3), cache.get("cover"))
    }

    @Test
    fun `put evicts least recently used entry`() {
        val cache = ArtworkDataCache(maxEntries = 2)

        cache.put("a", byteArrayOf(1))
        cache.put("b", byteArrayOf(2))
        assertNotNull(cache.get("a"))
        cache.put("c", byteArrayOf(3))

        assertNotNull(cache.get("a"))
        assertNull(cache.get("b"))
        assertNotNull(cache.get("c"))
    }
}
