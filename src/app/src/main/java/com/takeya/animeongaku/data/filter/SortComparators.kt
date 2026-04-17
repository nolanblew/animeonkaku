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
            val asc = Comparator.comparingInt<ThemeEntity> { themeTypeRank(it.themeType) }
                .thenComparingInt { theme ->
                    theme.themeType?.filter { ch -> ch.isDigit() }?.toIntOrNull() ?: 0
                }
            if (descending) asc.reversed() else asc
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
        SortAttribute.RANDOM -> Comparator { _, _ -> 0 }
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

private fun themeDefaultOrder(ctx: EvaluationContext): Comparator<ThemeEntity> =
    Comparator { a, b ->
        val animeA = a.animeId?.let { ctx.animeByThemesId[it] }
        val animeB = b.animeId?.let { ctx.animeByThemesId[it] }
        val titleCmp = (animeA?.title ?: "").compareTo(animeB?.title ?: "", ignoreCase = true)
        if (titleCmp != 0) return@Comparator titleCmp
        val typeRankA = themeTypeRank(a.themeType)
        val typeRankB = themeTypeRank(b.themeType)
        if (typeRankA != typeRankB) return@Comparator typeRankA - typeRankB
        val seqA = a.themeType?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        val seqB = b.themeType?.filter { it.isDigit() }?.toIntOrNull() ?: 0
        seqA - seqB
    }

internal fun themeTypeRank(themeType: String?): Int = when {
    themeType == null -> 4
    themeType.uppercase().startsWith("OP") -> 0
    themeType.uppercase().startsWith("IN") -> 1
    themeType.uppercase().startsWith("ED") -> 3
    else -> 2
}
