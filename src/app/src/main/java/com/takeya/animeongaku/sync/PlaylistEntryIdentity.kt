package com.takeya.animeongaku.sync

/** Stable synthetic identity for an occurrence in a legacy theme-only playlist payload. */
internal fun legacyPlaylistEntryId(themeId: Long, occurrence: Int): Long {
    val themeBits = themeId.hashCode().toLong() and 0x7fffffffL
    val occurrenceBits = (occurrence + 1).toLong() and 0x7fffffffL
    return -((themeBits shl 31) or occurrenceBits).coerceAtLeast(1L)
}
