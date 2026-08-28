package com.takeya.animeongaku.ui.search

import com.takeya.animeongaku.data.local.AnimeEntity
import java.text.Normalizer
import java.util.Locale

private const val LOCAL_ANIME_SEARCH_LIMIT = 50
private val OPTIONAL_CONNECTORS = setOf("x", "cross")

/**
 * Folds title text into the form used by local anime search.
 *
 * The x in titles such as SPY×FAMILY and HUNTER×HUNTER is a visual connector,
 * so it is ignored when it appears between title words. Punctuation and
 * diacritics are also folded so the query does not need to copy catalog styling.
 */
internal fun normalizeAnimeSearchText(value: String): String =
    prepareSearchText(value).normalized

internal fun searchAnimeCandidates(
    query: String,
    candidates: List<AnimeEntity>,
    limit: Int = LOCAL_ANIME_SEARCH_LIMIT
): List<AnimeEntity> {
    if (limit <= 0) return emptyList()

    val normalizedQuery = prepareSearchText(query)
    if (normalizedQuery.tokens.isEmpty()) return emptyList()

    return candidates.asSequence()
        .mapNotNull { candidate ->
            val score = candidate.titleValues()
                .asSequence()
                .mapNotNull { title -> matchScore(normalizedQuery, prepareSearchText(title)) }
                .maxOrNull()
                ?: return@mapNotNull null
            RankedAnime(candidate, score, candidate.title.orEmpty().lowercase(Locale.ROOT))
        }
        .sortedWith(compareByDescending<RankedAnime> { it.score }.thenBy { it.sortTitle })
        .take(limit)
        .map { it.anime }
        .toList()
}

private data class PreparedSearchText(
    val normalized: String,
    val tokens: List<String>,
    val compact: String
)

private data class RankedAnime(
    val anime: AnimeEntity,
    val score: Int,
    val sortTitle: String
)

private fun prepareSearchText(value: String): PreparedSearchText {
    val folded = Normalizer.normalize(value, Normalizer.Form.NFKD)
        .filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }
        .lowercase(Locale.ROOT)
        .replace("×", " x ")
        .replace("&", " and ")

    val rawTokens = folded
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .trim()
        .split(Regex("\\s+"))
        .filter(String::isNotBlank)

    val tokens = rawTokens.filterIndexed { index, token ->
        token !in OPTIONAL_CONNECTORS || index == 0 || index == rawTokens.lastIndex
    }
    val normalized = tokens.joinToString(" ")
    return PreparedSearchText(
        normalized = normalized,
        tokens = tokens,
        compact = tokens.joinToString("")
    )
}

private fun AnimeEntity.titleValues(): List<String> = listOfNotNull(
    title,
    titleEn,
    titleRomaji,
    titleJa
)

private fun matchScore(query: PreparedSearchText, title: PreparedSearchText): Int? {
    if (title.tokens.isEmpty()) return null
    if (query.normalized == title.normalized) return 1_000
    if (title.normalized.contains(query.normalized)) return 900
    if (query.compact == title.compact) return 875
    if (title.compact.contains(query.compact)) return 825
    if (containsTokenMultiset(title.tokens, query.tokens)) return 800

    val fuzzyDistance = fuzzyTokenDistance(query.tokens, title.tokens) ?: return null
    return 650 - (fuzzyDistance * 10)
}

private fun containsTokenMultiset(available: List<String>, required: List<String>): Boolean {
    val remaining = available.toMutableList()
    return required.all { token ->
        val index = remaining.indexOf(token)
        if (index < 0) {
            false
        } else {
            remaining.removeAt(index)
            true
        }
    }
}

private fun fuzzyTokenDistance(queryTokens: List<String>, titleTokens: List<String>): Int? {
    val used = BooleanArray(titleTokens.size)
    var totalDistance = 0

    for (queryToken in queryTokens) {
        var bestIndex = -1
        var bestDistance = Int.MAX_VALUE
        for (index in titleTokens.indices) {
            if (used[index]) continue
            val distance = levenshteinDistance(queryToken, titleTokens[index])
            if (distance < bestDistance) {
                bestIndex = index
                bestDistance = distance
            }
        }

        if (bestIndex < 0 || bestDistance > maximumEditDistance(queryToken.length)) return null
        used[bestIndex] = true
        totalDistance += bestDistance
    }

    return totalDistance
}

private fun maximumEditDistance(length: Int): Int = when {
    length <= 3 -> 0
    length <= 5 -> 1
    else -> 2
}

private fun levenshteinDistance(left: String, right: String): Int {
    if (left == right) return 0
    if (left.isEmpty()) return right.length
    if (right.isEmpty()) return left.length

    var previous = IntArray(right.length + 1) { it }
    for (leftIndex in left.indices) {
        val current = IntArray(right.length + 1)
        current[0] = leftIndex + 1
        for (rightIndex in right.indices) {
            val substitutionCost = if (left[leftIndex] == right[rightIndex]) 0 else 1
            current[rightIndex + 1] = minOf(
                current[rightIndex] + 1,
                previous[rightIndex + 1] + 1,
                previous[rightIndex] + substitutionCost
            )
        }
        previous = current
    }
    return previous[right.length]
}
