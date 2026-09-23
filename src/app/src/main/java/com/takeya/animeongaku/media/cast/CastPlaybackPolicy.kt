package com.takeya.animeongaku.media.cast

internal fun castAudioPath(mediaKey: String?): String? {
    val match = Regex("^(THEME|SONG):([1-9][0-9]*):(TV_SIZE|AUDIO)$").matchEntire(mediaKey.orEmpty()) ?: return null
    val (kind, id, variant) = match.destructured
    if (id.toLongOrNull() == null) return null
    return when {
        kind == "THEME" && variant == "TV_SIZE" -> "themes/$id.mp3"
        kind == "SONG" && variant == "AUDIO" -> "songs/$id.mp3"
        else -> null
    }
}

internal data class CastHandoff(val index: Int, val positionMs: Long, val playWhenReady: Boolean)

internal fun shouldRecordPlaybackStart(remote: Boolean, sameOccurrence: Boolean, playlistReplacement: Boolean): Boolean =
    !(remote && sameOccurrence && playlistReplacement)

internal fun castHandoff(ids: List<String>, currentId: String?, positionMs: Long, playing: Boolean, toCast: Boolean): CastHandoff? {
    val index = ids.indexOf(currentId)
    return if (index < 0) null else CastHandoff(index, positionMs.coerceAtLeast(0), playing && toCast)
}
