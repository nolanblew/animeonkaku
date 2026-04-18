package com.takeya.animeongaku.data.filter

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Build a comparator that applies each [SortKey] in order (earlier keys win
 * ties) and falls back to [themeDefaultOrder] so identical sort values still
 * land in a predictable place.
 *
 * Nulls are always sorted last, regardless of direction — bubbling up
 * incomplete metadata is worse than pushing it to the bottom.
 */
internal fun buildThemeComparator(
    sort: SortSpec,
    ctx: EvaluationContext
): Comparator<ThemeEntity> {
    val randomSeed = ctx.nowMillis
    var comparator: Comparator<ThemeEntity>? = null
    for (key in sort.keys) {
        val keyComparator = comparatorForKey(key, ctx, randomSeed)
        comparator = if (comparator == null) keyComparator else comparator.then(keyComparator)
    }
    val fallback = themeDefaultOrder(ctx)
    return comparator?.then(fallback) ?: fallback
}

private fun comparatorForKey(
    key: SortKey,
    ctx: EvaluationContext,
    randomSeed: Long
): Comparator<ThemeEntity> {
    val attr = key.attribute
    if (attr == SortAttribute.RANDOM) {
        return Comparator.comparingLong { theme: ThemeEntity ->
            // Mix the seed and id so different seeds yield different orders,
            // and two themes rarely tie.
            (theme.id xor randomSeed) * 0x9E3779B97F4A7C15UL.toLong()
        }
    }
    val descending = key.direction == SortDirection.DESC
    return when (attr) {
        SortAttribute.TITLE ->
            nonNullStringComparator(descending) { it.title }
        SortAttribute.ARTIST ->
            nullableStringComparator(descending) { it.artistName }
        SortAttribute.ANIME_TITLE ->
            nullableStringComparator(descending) { animeFor(it, ctx)?.title }
        SortAttribute.THEME_TYPE -> {
            val order = key.categoricalOrder ?: SortKey.defaultCategoricalOrder(SortAttribute.THEME_TYPE)
            Comparator.comparingInt<ThemeEntity> { categoricalRank(it.themeType?.uppercase()?.take(2), order) }
                .thenComparingInt { theme ->
                    theme.themeType?.filter { ch -> ch.isDigit() }?.toIntOrNull() ?: 0
                }
        }
        SortAttribute.WATCHING_STATUS -> {
            val order = key.categoricalOrder ?: SortKey.defaultCategoricalOrder(SortAttribute.WATCHING_STATUS)
            Comparator.comparingInt<ThemeEntity> { categoricalRank(animeFor(it, ctx)?.watchingStatus, order) }
        }
        SortAttribute.SUBTYPE -> {
            val order = key.categoricalOrder ?: SortKey.defaultCategoricalOrder(SortAttribute.SUBTYPE)
            Comparator.comparingInt<ThemeEntity> { categoricalRank(animeFor(it, ctx)?.subtype?.lowercase(), order) }
        }
        SortAttribute.SEASON -> {
            val order = key.categoricalOrder ?: SortKey.defaultCategoricalOrder(SortAttribute.SEASON)
            Comparator.comparingInt<ThemeEntity> { theme ->
                val month = animeFor(theme, ctx)?.startDate?.drop(5)?.take(2)?.toIntOrNull()
                val season = month?.let { monthToSeason(it) }?.name
                categoricalRank(season, order)
            }
        }
        SortAttribute.AIRED_DATE ->
            nullableLongComparator(descending) { theme ->
                animeFor(theme, ctx)?.startDate?.let(::parseStartDateMillis)
            }
        SortAttribute.WATCHED_DATE ->
            nullableLongComparator(descending) { theme -> animeFor(theme, ctx)?.libraryUpdatedAt }
        SortAttribute.AVERAGE_RATING ->
            nullableDoubleComparator(descending) { theme -> animeFor(theme, ctx)?.averageRating }
        SortAttribute.MY_RATING ->
            nullableDoubleComparator(descending) { theme -> animeFor(theme, ctx)?.userRating }
        SortAttribute.PLAY_COUNT -> {
            val asc = Comparator.comparingInt<ThemeEntity> { theme ->
                ctx.playCountByTheme[theme.id] ?: 0
            }
            if (descending) asc.reversed() else asc
        }
        SortAttribute.LAST_PLAYED ->
            nullableLongComparator(descending) { theme -> ctx.lastPlayedByTheme[theme.id] }
        SortAttribute.LIKED ->
            booleanComparator(descending) { it.id in ctx.likedThemeIds }
        SortAttribute.DOWNLOADED ->
            booleanComparator(descending) { it.id in ctx.downloadedThemeIds }
        SortAttribute.RANDOM -> Comparator { _, _ -> 0 } // handled above, never reached
    }
}

private inline fun nullableStringComparator(
    descending: Boolean,
    crossinline selector: (ThemeEntity) -> String?
): Comparator<ThemeEntity> = Comparator { a, b ->
    val va = selector(a)
    val vb = selector(b)
    when {
        va == null && vb == null -> 0
        va == null -> 1
        vb == null -> -1
        else -> {
            val cmp = String.CASE_INSENSITIVE_ORDER.compare(va, vb)
            if (descending) -cmp else cmp
        }
    }
}

private inline fun nonNullStringComparator(
    descending: Boolean,
    crossinline selector: (ThemeEntity) -> String
): Comparator<ThemeEntity> = Comparator { a, b ->
    val cmp = String.CASE_INSENSITIVE_ORDER.compare(selector(a), selector(b))
    if (descending) -cmp else cmp
}

private inline fun nullableLongComparator(
    descending: Boolean,
    crossinline selector: (ThemeEntity) -> Long?
): Comparator<ThemeEntity> = Comparator { a, b ->
    val va = selector(a)
    val vb = selector(b)
    when {
        va == null && vb == null -> 0
        va == null -> 1
        vb == null -> -1
        else -> {
            val cmp = va.compareTo(vb)
            if (descending) -cmp else cmp
        }
    }
}

private inline fun nullableDoubleComparator(
    descending: Boolean,
    crossinline selector: (ThemeEntity) -> Double?
): Comparator<ThemeEntity> = Comparator { a, b ->
    val va = selector(a)
    val vb = selector(b)
    when {
        va == null && vb == null -> 0
        va == null -> 1
        vb == null -> -1
        else -> {
            val cmp = va.compareTo(vb)
            if (descending) -cmp else cmp
        }
    }
}

private inline fun booleanComparator(
    descending: Boolean,
    crossinline selector: (ThemeEntity) -> Boolean
): Comparator<ThemeEntity> = Comparator { a, b ->
    val va = if (selector(a)) 0 else 1
    val vb = if (selector(b)) 0 else 1
    val cmp = va - vb
    if (descending) -cmp else cmp
}

private fun animeFor(theme: ThemeEntity, ctx: EvaluationContext): AnimeEntity? =
    theme.animeId?.let { ctx.animeByThemesId[it] }

private fun parseStartDateMillis(raw: String): Long? {
    val year = raw.take(4).toIntOrNull() ?: return null
    val month = raw.drop(5).take(2).toIntOrNull()?.coerceIn(1, 12) ?: 1
    val day = raw.drop(8).take(2).toIntOrNull()?.coerceIn(1, 28) ?: 1
    return LocalDate.of(year, month, day)
        .atStartOfDay(ZoneOffset.UTC)
        .toInstant()
        .toEpochMilli()
}

private val defaultThemeTypeOrder = SortKey.defaultCategoricalOrder(SortAttribute.THEME_TYPE)

private fun themeDefaultOrder(ctx: EvaluationContext): Comparator<ThemeEntity> =
    Comparator { a, b ->
        val animeA = a.animeId?.let { ctx.animeByThemesId[it] }
        val animeB = b.animeId?.let { ctx.animeByThemesId[it] }
        val titleCmp = (animeA?.title ?: "").compareTo(animeB?.title ?: "", ignoreCase = true)
        if (titleCmp != 0) return@Comparator titleCmp
        val typeRankA = categoricalRank(a.themeType?.uppercase()?.take(2), defaultThemeTypeOrder)
        val typeRankB = categoricalRank(b.themeType?.uppercase()?.take(2), defaultThemeTypeOrder)
        if (typeRankA != typeRankB) return@Comparator typeRankA - typeRankB
        val seqA = a.themeType?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        val seqB = b.themeType?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        seqA - seqB
    }

/**
 * Returns the position of [value] in [order] (case-insensitive prefix match for theme types),
 * or [order].size if not found — so unknowns always sort last.
 */
internal fun categoricalRank(value: String?, order: List<String>): Int {
    if (value == null) return order.size
    val upper = value.uppercase()
    return order.indexOfFirst { upper.startsWith(it.uppercase()) }.takeIf { it >= 0 } ?: order.size
}

private fun monthToSeason(month: Int): Season? = when (month) {
    1, 2, 3 -> Season.WINTER
    4, 5, 6 -> Season.SPRING
    7, 8, 9 -> Season.SUMMER
    10, 11, 12 -> Season.FALL
    else -> null
}
