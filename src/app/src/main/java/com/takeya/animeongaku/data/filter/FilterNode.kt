package com.takeya.animeongaku.data.filter

sealed interface FilterNode {
    // --- Operators ---
    data class And(val children: List<FilterNode>) : FilterNode
    data class Or(val children: List<FilterNode>) : FilterNode
    data class Not(val child: FilterNode) : FilterNode

    // --- Anime metadata leaves ---
    /** Anime must have (any or all of) the given genre slugs */
    data class GenreIn(val slugs: List<String>, val matchAll: Boolean = false) : FilterNode
    /** Anime aired strictly before this year */
    data class AiredBefore(val year: Int) : FilterNode
    /** Anime aired strictly after (or in) this year */
    data class AiredAfter(val year: Int) : FilterNode
    /** Anime aired within the given year range (inclusive) */
    data class AiredBetween(val minYear: Int, val maxYear: Int) : FilterNode
    /** Anime aired in one of the given seasons */
    data class SeasonIn(val seasons: List<Season>) : FilterNode
    /** Anime subtype matches (TV/movie/OVA/ONA/special/music) */
    data class SubtypeIn(val subtypes: List<String>) : FilterNode
    /** Kitsu community average rating >= min (0..10 scale) */
    data class AverageRatingGte(val min: Double) : FilterNode
    /** User's personal Kitsu rating >= min (0..10 scale) */
    data class UserRatingGte(val min: Double) : FilterNode

    // --- Library/user leaves ---
    /** Anime has one of the given watching statuses */
    data class WatchingStatusIn(val statuses: List<String>) : FilterNode
    /** Library entry was updated after this exact timestamp */
    data class LibraryUpdatedAfter(val epochMillis: Long) : FilterNode
    /** Library entry was updated within the past durationMillis ms (relative — evaluated at call time) */
    data class LibraryUpdatedWithin(val durationMillis: Long) : FilterNode

    // --- Theme leaves ---
    /** Theme type starts with any of the given prefixes ("OP", "ED", "IN") */
    data class ThemeTypeIn(val types: List<String>) : FilterNode
    /** Theme artist name matches (case-insensitive) any in the list */
    data class ArtistIn(val artistNames: List<String>) : FilterNode
    /** Theme is in the user's liked list */
    class Liked : FilterNode {
        override fun equals(other: Any?): Boolean = other is Liked
        override fun hashCode(): Int = javaClass.hashCode()
        override fun toString(): String = "Liked"
    }
    /** Theme is in the user's disliked list */
    class Disliked : FilterNode {
        override fun equals(other: Any?): Boolean = other is Disliked
        override fun hashCode(): Int = javaClass.hashCode()
        override fun toString(): String = "Disliked"
    }
    /** Theme has been downloaded to local storage */
    class Downloaded : FilterNode {
        override fun equals(other: Any?): Boolean = other is Downloaded
        override fun hashCode(): Int = javaClass.hashCode()
        override fun toString(): String = "Downloaded"
    }
    /** Theme has been played at least min times */
    data class PlayCountGte(val min: Int) : FilterNode
    /** Theme was last played after this timestamp */
    data class PlayedSince(val epochMillis: Long) : FilterNode
}

enum class Season { WINTER, SPRING, SUMMER, FALL }
