package com.takeya.animeongaku.data.local

import java.text.Normalizer

/** Only reversible Latin given/family-name order is treated as an alias. */
internal fun artistIdentity(name: String): String {
    val normalized = Normalizer.normalize(name, Normalizer.Form.NFKC).lowercase()
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()
    val tokens = normalized.split(Regex("\\s+")).filter(String::isNotBlank)
    val reversibleLatin = tokens.size in 2..4 && tokens.all { token -> token.all { it.code < 128 && it.isLetter() } }
    return if (reversibleLatin) tokens.sorted().joinToString(" ") else tokens.joinToString(" ")
}

internal fun mergeArtistTrackCounts(counts: List<ArtistTrackCount>): List<ArtistTrackCount> =
    counts.filter { it.artistName.isNotBlank() }.groupBy { artistIdentity(it.artistName) }.values.map { group ->
        val preferred = group.map(ArtistTrackCount::artistName).sortedWith(compareBy<String>({ it.length }, { it })).first()
        ArtistTrackCount(preferred, group.sumOf(ArtistTrackCount::trackCount))
    }.sortedWith(compareByDescending<ArtistTrackCount> { it.trackCount }.thenBy { it.artistName.lowercase() })
