package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.filter.FilterNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterNodeSerializationTest {

    private val moshi = Moshi.Builder()
        .add(
            PolymorphicJsonAdapterFactory.of(FilterNode::class.java, "type")
                .withSubtype(FilterNode.And::class.java, "and")
                .withSubtype(FilterNode.Or::class.java, "or")
                .withSubtype(FilterNode.Not::class.java, "not")
                .withSubtype(FilterNode.GenreIn::class.java, "genre_in")
                .withSubtype(FilterNode.AiredBefore::class.java, "aired_before")
                .withSubtype(FilterNode.AiredAfter::class.java, "aired_after")
                .withSubtype(FilterNode.AiredBetween::class.java, "aired_between")
                .withSubtype(FilterNode.SeasonIn::class.java, "season_in")
                .withSubtype(FilterNode.SubtypeIn::class.java, "subtype_in")
                .withSubtype(FilterNode.AverageRatingGte::class.java, "average_rating_gte")
                .withSubtype(FilterNode.UserRatingGte::class.java, "user_rating_gte")
                .withSubtype(FilterNode.WatchingStatusIn::class.java, "watching_status_in")
                .withSubtype(FilterNode.LibraryUpdatedAfter::class.java, "library_updated_after")
                .withSubtype(FilterNode.LibraryUpdatedWithin::class.java, "library_updated_within")
                .withSubtype(FilterNode.ThemeTypeIn::class.java, "theme_type_in")
                .withSubtype(FilterNode.ArtistIn::class.java, "artist_in")
                .withSubtype(FilterNode.Liked::class.java, "liked")
                .withSubtype(FilterNode.Disliked::class.java, "disliked")
                .withSubtype(FilterNode.Downloaded::class.java, "downloaded")
                .withSubtype(FilterNode.PlayCountGte::class.java, "play_count_gte")
                .withSubtype(FilterNode.PlayedSince::class.java, "played_since")
        )
        .add(KotlinJsonAdapterFactory())
        .build()

    private val adapter = moshi.adapter(FilterNode::class.java)

    @Test
    fun `serializes singleton-like leaf filters without crashing`() {
        val nodes = listOf(
            FilterNode.Liked(),
            FilterNode.Disliked(),
            FilterNode.Downloaded()
        )

        nodes.forEach { node ->
            val json = adapter.toJson(node)
            val restored = adapter.fromJson(json)

            assertTrue(json.contains("\"type\""))
            assertNotNull(restored)
            assertEquals(node, restored)
        }
    }

    @Test
    fun `round trips nested filters that include liked and downloaded nodes`() {
        val filter = FilterNode.And(
            listOf(
                FilterNode.Liked(),
                FilterNode.Not(FilterNode.Downloaded()),
                FilterNode.Or(
                    listOf(
                        FilterNode.PlayCountGte(5),
                        FilterNode.ThemeTypeIn(listOf("OP"))
                    )
                )
            )
        )

        val json = adapter.toJson(filter)
        val restored = adapter.fromJson(json)

        assertNotNull(restored)
        assertEquals(filter, restored)
    }
}
