package com.takeya.animeongaku

import com.squareup.moshi.Moshi
import com.squareup.moshi.adapters.PolymorphicJsonAdapterFactory
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.DateAnchor
import com.takeya.animeongaku.data.filter.DateOperator
import com.takeya.animeongaku.data.filter.FilterNode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FilterNodeSerializationTest {

    private val moshi: Moshi = run {
        val filterNodeFactory = PolymorphicJsonAdapterFactory.of(FilterNode::class.java, "type")
            .withSubtype(FilterNode.And::class.java, "and")
            .withSubtype(FilterNode.Or::class.java, "or")
            .withSubtype(FilterNode.Not::class.java, "not")
            .withSubtype(FilterNode.GenreIn::class.java, "genre_in")
            .withSubtype(FilterNode.AiredOn::class.java, "aired_on")
            .withSubtype(FilterNode.SeasonIn::class.java, "season_in")
            .withSubtype(FilterNode.SubtypeIn::class.java, "subtype_in")
            .withSubtype(FilterNode.AverageRatingGte::class.java, "average_rating_gte")
            .withSubtype(FilterNode.UserRatingGte::class.java, "user_rating_gte")
            .withSubtype(FilterNode.WatchingStatusIn::class.java, "watching_status_in")
            .withSubtype(FilterNode.WatchedOn::class.java, "watched_on")
            .withSubtype(FilterNode.ThemeTypeIn::class.java, "theme_type_in")
            .withSubtype(FilterNode.ArtistIn::class.java, "artist_in")
            .withSubtype(FilterNode.TitleMatches::class.java, "title_matches")
            .withSubtype(FilterNode.SongTitleMatches::class.java, "song_title_matches")
            .withSubtype(FilterNode.Liked::class.java, "liked")
            .withSubtype(FilterNode.Disliked::class.java, "disliked")
            .withSubtype(FilterNode.Downloaded::class.java, "downloaded")
            .withSubtype(FilterNode.PlayCountGte::class.java, "play_count_gte")
            .withSubtype(FilterNode.PlayedOn::class.java, "played_on")
            .withSubtype(FilterNode.AiredBefore::class.java, "aired_before")
            .withSubtype(FilterNode.AiredAfter::class.java, "aired_after")
            .withSubtype(FilterNode.AiredBetween::class.java, "aired_between")
            .withSubtype(FilterNode.LibraryUpdatedAfter::class.java, "library_updated_after")
            .withSubtype(FilterNode.LibraryUpdatedWithin::class.java, "library_updated_within")
            .withSubtype(FilterNode.PlayedSince::class.java, "played_since")

        val dateAnchorFactory = PolymorphicJsonAdapterFactory.of(DateAnchor::class.java, "type")
            .withSubtype(DateAnchor.AbsoluteYear::class.java, "absolute_year")
            .withSubtype(DateAnchor.Relative::class.java, "relative")

        val customRangeFactory = PolymorphicJsonAdapterFactory.of(CustomRange::class.java, "type")
            .withSubtype(CustomRange.Relative::class.java, "relative")
            .withSubtype(CustomRange.Exact::class.java, "exact")

        Moshi.Builder()
            .add(filterNodeFactory)
            .add(dateAnchorFactory)
            .add(customRangeFactory)
            .add(KotlinJsonAdapterFactory())
            .build()
    }

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

    @Test
    fun `round trips TitleMatches with plain and regex modes`() {
        val plain = FilterNode.TitleMatches(pattern = "Attack on Titan", isRegex = false)
        val regex = FilterNode.TitleMatches(pattern = "^(Attack|Shingeki)", isRegex = true)

        listOf(plain, regex).forEach { node ->
            val json = adapter.toJson(node)
            val restored = adapter.fromJson(json)
            assertTrue(json.contains("\"type\":\"title_matches\""))
            assertEquals(node, restored)
        }
    }

    @Test
    fun `round trips SongTitleMatches with plain and regex modes`() {
        val plain = FilterNode.SongTitleMatches(pattern = "opening", isRegex = false)
        val regex = FilterNode.SongTitleMatches(pattern = "^OP\\s*\\d+$", isRegex = true)

        listOf(plain, regex).forEach { node ->
            val json = adapter.toJson(node)
            val restored = adapter.fromJson(json)
            assertTrue(json.contains("\"type\":\"song_title_matches\""))
            assertEquals(node, restored)
        }
    }

    @Test
    fun `round trips AiredOn with absolute and relative anchors`() {
        val absoluteGt = FilterNode.AiredOn(
            operator = DateOperator.GT,
            anchor = DateAnchor.AbsoluteYear(2015)
        )
        val between = FilterNode.AiredOn(
            operator = DateOperator.BETWEEN,
            anchor = DateAnchor.AbsoluteYear(2010),
            endAnchor = DateAnchor.AbsoluteYear(2020)
        )
        val relative = FilterNode.AiredOn(
            operator = DateOperator.GT,
            anchor = DateAnchor.Relative(com.takeya.animeongaku.data.filter.DateUnit.YEARS, 2)
        )

        listOf(absoluteGt, between, relative).forEach { node ->
            val json = adapter.toJson(node)
            val restored = adapter.fromJson(json)
            assertTrue(json.contains("\"type\":\"aired_on\""))
            assertEquals(node, restored)
        }
    }

    @Test
    fun `round trips WatchedOn and PlayedOn`() {
        val watchedOn = FilterNode.WatchedOn(
            operator = DateOperator.GT,
            anchor = DateAnchor.Relative(com.takeya.animeongaku.data.filter.DateUnit.DAYS, 30)
        )
        val playedOn = FilterNode.PlayedOn(
            operator = DateOperator.LT,
            anchor = DateAnchor.AbsoluteYear(2023)
        )

        listOf(watchedOn, playedOn).forEach { node ->
            val json = adapter.toJson(node)
            val restored = adapter.fromJson(json)
            assertNotNull(restored)
            assertEquals(node, restored)
        }
    }

    @Test
    fun `round trips complex filter with new nodes combined`() {
        val filter = FilterNode.And(
            listOf(
                FilterNode.TitleMatches("(?i)hero", isRegex = true),
                FilterNode.Or(
                    listOf(
                        FilterNode.SongTitleMatches("opening", isRegex = false),
                        FilterNode.AiredOn(
                            operator = DateOperator.BETWEEN,
                            anchor = DateAnchor.AbsoluteYear(2018),
                            endAnchor = DateAnchor.AbsoluteYear(2023)
                        )
                    )
                ),
                FilterNode.Not(FilterNode.Disliked())
            )
        )

        val json = adapter.toJson(filter)
        val restored = adapter.fromJson(json)

        assertNotNull(restored)
        assertEquals(filter, restored)
    }
}
