package com.takeya.animeongaku.data.filter

import java.time.LocalDate
import java.time.ZoneOffset

// ---------------------------------------------------------------------------
// Enums / sealed types that drive simple-mode filter compilation
// ---------------------------------------------------------------------------

enum class TimeMode {
    ANY,
    LAST_6_MONTHS,
    LAST_2_YEARS,
    BEFORE_2000,
    Y2000_2010,
    Y2010_2020,
    CUSTOM
}

enum class TimeDimension { AIRED, WATCHED }
enum class RatingSource { MINE, AVERAGE }

sealed interface CustomRange {
    data class Relative(val durationMillis: Long) : CustomRange
    data class Exact(val startYear: Int, val endYear: Int) : CustomRange
}

// ---------------------------------------------------------------------------
// Simple sections state — the full set of user selections in simple mode
// ---------------------------------------------------------------------------

data class SimpleSectionsState(
    val timeMode: TimeMode = TimeMode.ANY,
    val customRange: CustomRange? = null,
    val timeDimension: TimeDimension = TimeDimension.AIRED,
    val seasons: Set<Season> = emptySet(),
    val genreSlugs: Set<String> = emptySet(),
    val genreMatchAll: Boolean = false,
    val minRating: Double? = null,
    val ratingSource: RatingSource = RatingSource.MINE,
    val subtypes: Set<String> = emptySet(),
    val watchingStatuses: Set<String> = emptySet(),
    val themeTypes: Set<String> = emptySet()
)

// ---------------------------------------------------------------------------
// Compiler: SimpleSectionsState → FilterNode
// ---------------------------------------------------------------------------

fun compileSimpleFilter(simpleState: SimpleSectionsState): FilterNode {
    val children = mutableListOf<FilterNode>()
    val s = simpleState

    when (s.timeMode) {
        TimeMode.ANY -> { /* no filter */ }
        TimeMode.LAST_6_MONTHS -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                children += FilterNode.WatchedOn(
                    operator = DateOperator.GT,
                    anchor = DateAnchor.Relative(unit = DateUnit.DAYS, amount = 182)
                )
            }
        }
        TimeMode.LAST_2_YEARS -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                children += FilterNode.WatchedOn(
                    operator = DateOperator.GT,
                    anchor = DateAnchor.Relative(unit = DateUnit.YEARS, amount = 2)
                )
            }
        }
        TimeMode.BEFORE_2000 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(endYearInclusive = 1999)?.let(children::add)
            } else {
                children += FilterNode.AiredOn(DateOperator.LT, DateAnchor.AbsoluteYear(2000))
            }
        }
        TimeMode.Y2000_2010 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(startYearInclusive = 2000, endYearInclusive = 2010)?.let(children::add)
            } else {
                children += FilterNode.AiredOn(
                    DateOperator.BETWEEN,
                    DateAnchor.AbsoluteYear(2000),
                    DateAnchor.AbsoluteYear(2010)
                )
            }
        }
        TimeMode.Y2010_2020 -> {
            if (s.timeDimension == TimeDimension.WATCHED) {
                watchedYearFilter(startYearInclusive = 2010, endYearInclusive = 2020)?.let(children::add)
            } else {
                children += FilterNode.AiredOn(
                    DateOperator.BETWEEN,
                    DateAnchor.AbsoluteYear(2010),
                    DateAnchor.AbsoluteYear(2020)
                )
            }
        }
        TimeMode.CUSTOM -> {
            val range = s.customRange
            if (range != null) {
                when {
                    range is CustomRange.Relative && s.timeDimension == TimeDimension.WATCHED ->
                        children += FilterNode.WatchedOn(
                            operator = DateOperator.GT,
                            anchor = DateAnchor.Relative(unit = DateUnit.DAYS, amount = (range.durationMillis / DAY_MS).toInt())
                        )
                    range is CustomRange.Exact && s.timeDimension == TimeDimension.AIRED ->
                        children += FilterNode.AiredOn(
                            DateOperator.BETWEEN,
                            DateAnchor.AbsoluteYear(range.startYear),
                            DateAnchor.AbsoluteYear(range.endYear)
                        )
                    range is CustomRange.Exact && s.timeDimension == TimeDimension.WATCHED -> {
                        val startYear = minOf(range.startYear, range.endYear)
                        val endYear = maxOf(range.startYear, range.endYear)
                        watchedYearFilter(startYear, endYear)?.let(children::add)
                    }
                    else -> { /* no filter */ }
                }
            }
        }
    }

    if (s.seasons.isNotEmpty()) {
        children += FilterNode.SeasonIn(s.seasons.toList())
    }

    if (s.genreSlugs.isNotEmpty()) {
        children += FilterNode.GenreIn(s.genreSlugs.toList(), s.genreMatchAll)
    }

    s.minRating?.let { min ->
        children += if (s.ratingSource == RatingSource.MINE) {
            FilterNode.UserRatingGte(min)
        } else {
            FilterNode.AverageRatingGte(min)
        }
    }

    if (s.subtypes.isNotEmpty()) {
        children += FilterNode.SubtypeIn(s.subtypes.toList())
    }

    if (s.watchingStatuses.isNotEmpty()) {
        children += FilterNode.WatchingStatusIn(s.watchingStatuses.toList())
    }

    if (s.themeTypes.isNotEmpty()) {
        children += FilterNode.ThemeTypeIn(s.themeTypes.toList())
    }

    return FilterNode.And(children)
}

private const val DAY_MS = 24L * 60L * 60L * 1000L

private fun watchedYearFilter(
    startYearInclusive: Int? = null,
    endYearInclusive: Int? = null
): FilterNode? {
    val clauses = mutableListOf<FilterNode>()

    val startMillis = startYearInclusive?.let { startOfYearUtcMillis(it) - 1L } ?: 0L
    clauses += FilterNode.WatchedOn(
        operator = DateOperator.GT,
        anchor = DateAnchor.AbsoluteYear(startYearInclusive ?: 0)
    )

    endYearInclusive?.let { endYear ->
        clauses += FilterNode.Not(
            FilterNode.WatchedOn(
                operator = DateOperator.GT,
                anchor = DateAnchor.AbsoluteYear(endYear + 1)
            )
        )
    }

    return when (clauses.size) {
        0 -> null
        1 -> clauses.single()
        else -> FilterNode.And(clauses)
    }
}

internal fun startOfYearUtcMillis(year: Int): Long {
    return LocalDate.of(year, 1, 1)
        .atStartOfDay()
        .toInstant(ZoneOffset.UTC)
        .toEpochMilli()
}
