package com.takeya.animeongaku.data.filter

// ---------------------------------------------------------------------------
// Date operator / anchor types (used by AiredOn, WatchedOn, PlayedOn)
// ---------------------------------------------------------------------------

enum class DateOperator { GT, LT, BETWEEN }
enum class DateUnit { DAYS, MONTHS, YEARS }

sealed interface DateAnchor {
    data class AbsoluteYear(val year: Int) : DateAnchor
    data class Relative(val unit: DateUnit, val amount: Int) : DateAnchor
}

// ---------------------------------------------------------------------------
// Filter node hierarchy
// ---------------------------------------------------------------------------

sealed interface FilterNode {
    // --- Operators ---
    data class And(val children: List<FilterNode>) : FilterNode
    data class Or(val children: List<FilterNode>) : FilterNode
    data class Not(val child: FilterNode) : FilterNode

    // --- Anime metadata leaves ---
    /** Anime must have (any or all of) the given genre slugs */
    data class GenreIn(val slugs: List<String>, val matchAll: Boolean = false) : FilterNode
    /** Unified aired-date filter with operator and relative/absolute anchors */
    data class AiredOn(
        val operator: DateOperator,
        val anchor: DateAnchor,
        val endAnchor: DateAnchor? = null
    ) : FilterNode
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
    /** Unified watched-date filter with operator and relative/absolute anchors */
    data class WatchedOn(
        val operator: DateOperator,
        val anchor: DateAnchor,
        val endAnchor: DateAnchor? = null
    ) : FilterNode

    // --- Theme leaves ---
    /** Theme type starts with any of the given prefixes ("OP", "ED", "IN") */
    data class ThemeTypeIn(val types: List<String>) : FilterNode
    /** Theme artist name matches (case-insensitive) any in the list */
    data class ArtistIn(val artistNames: List<String>) : FilterNode
    /** Theme anime title matches — plain contains (case-insensitive) or regex */
    data class TitleMatches(val pattern: String, val isRegex: Boolean = false) : FilterNode
    /** Theme song title matches — plain contains (case-insensitive) or regex */
    data class SongTitleMatches(val pattern: String, val isRegex: Boolean = false) : FilterNode
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
    /** Unified last-played filter with operator and relative/absolute anchors */
    data class PlayedOn(
        val operator: DateOperator,
        val anchor: DateAnchor,
        val endAnchor: DateAnchor? = null
    ) : FilterNode

    // --- Legacy nodes (read-only, kept for safe deserialization of old specs) ---
    @Deprecated("Use AiredOn with DateOperator.LT")
    data class AiredBefore(val year: Int) : FilterNode
    @Deprecated("Use AiredOn with DateOperator.GT")
    data class AiredAfter(val year: Int) : FilterNode
    @Deprecated("Use AiredOn with DateOperator.BETWEEN")
    data class AiredBetween(val minYear: Int, val maxYear: Int) : FilterNode
    @Deprecated("Use WatchedOn with DateOperator.GT and DateAnchor.AbsoluteYear")
    data class LibraryUpdatedAfter(val epochMillis: Long) : FilterNode
    @Deprecated("Use WatchedOn with DateOperator.GT and DateAnchor.Relative")
    data class LibraryUpdatedWithin(val durationMillis: Long) : FilterNode
    @Deprecated("Use PlayedOn with DateOperator.GT")
    data class PlayedSince(val epochMillis: Long) : FilterNode
}

enum class Season { WINTER, SPRING, SUMMER, FALL }
