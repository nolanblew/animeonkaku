package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import org.junit.Assert.assertEquals
import org.junit.Test

class SortSpecSerializationTest {

    private val moshi: Moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()
    private val adapter = moshi.adapter(SortSpec::class.java)

    @Test
    fun `round trip default sort spec`() {
        val json = adapter.toJson(SortSpec.DEFAULT)
        val restored = adapter.fromJson(json)
        assertEquals(SortSpec.DEFAULT, restored)
    }

    @Test
    fun `round trip custom sort spec with every attribute kind`() {
        val spec = SortSpec(
            listOf(
                SortKey(SortAttribute.MY_RATING, SortDirection.DESC),
                SortKey(SortAttribute.TITLE, SortDirection.ASC),
                SortKey(SortAttribute.LIKED, SortDirection.ASC),
                SortKey(SortAttribute.RANDOM, SortDirection.ASC),
                SortKey(SortAttribute.THEME_TYPE, SortDirection.DESC)
            )
        )
        val restored = adapter.fromJson(adapter.toJson(spec))
        assertEquals(spec, restored)
    }

    @Test
    fun `empty key list round trips without crashing`() {
        val spec = SortSpec(emptyList())
        val restored = adapter.fromJson(adapter.toJson(spec))
        assertEquals(spec, restored)
    }
}
