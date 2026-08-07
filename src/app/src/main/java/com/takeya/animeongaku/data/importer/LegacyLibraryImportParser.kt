package com.takeya.animeongaku.data.importer

import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImport
import com.takeya.animeongaku.data.remote.OngakuLegacyLibraryImportEntry
import javax.inject.Inject
import javax.inject.Singleton

class LegacyLibraryImportParseException(message: String) : IllegalArgumentException(message)

@Singleton
class LegacyLibraryImportParser @Inject constructor(
    moshi: Moshi
) {
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    fun parse(contents: String): OngakuLegacyLibraryImport {
        val root = runCatching { mapAdapter.fromJson(contents) }.getOrNull()
            ?: throw LegacyLibraryImportParseException("The selected file is not valid JSON.")

        val entries = LinkedHashMap<Long, MutableLegacyEntry>()
        parseEntryList(root.firstList("entries"), entries, EntryMode.Full)
        parseEntryList(
            root.firstList("userPreferences", "user_preferences", "preferences"),
            entries,
            EntryMode.Preference
        )
        parseEntryList(root.firstList("playCounts", "play_counts", "play_count"), entries, EntryMode.PlayCount)

        val payloadEntries = entries.values
            .mapNotNull { it.toPayloadEntry() }
            .sortedBy { it.themeId }

        if (payloadEntries.isEmpty()) {
            throw LegacyLibraryImportParseException(
                "The selected file does not contain any legacy likes, dislikes, or play counts."
            )
        }

        return OngakuLegacyLibraryImport(payloadEntries)
    }

    private fun parseEntryList(
        rawList: List<*>?,
        entries: LinkedHashMap<Long, MutableLegacyEntry>,
        mode: EntryMode
    ) {
        rawList ?: return
        rawList.forEachIndexed { index, raw ->
            val item = raw as? Map<*, *>
                ?: throw LegacyLibraryImportParseException("Legacy import row ${index + 1} is not an object.")
            val themeId = item.longField("themeId", "theme_id")
                ?: throw LegacyLibraryImportParseException("Legacy import row ${index + 1} is missing a themeId.")
            if (themeId <= 0L) {
                throw LegacyLibraryImportParseException("Legacy import row ${index + 1} has an invalid themeId.")
            }

            val entry = entries.getOrPut(themeId) { MutableLegacyEntry(themeId = themeId) }
            when (mode) {
                EntryMode.Full -> {
                    val liked = item.booleanField("liked", "isLiked", "is_liked") ?: false
                    val disliked = item.booleanField("disliked", "isDisliked", "is_disliked") ?: false
                    entry.setPreference(index, liked, disliked)
                    item.intField("playCount", "play_count")?.let { entry.setPlayCount(index, it) }
                    item.longField("lastPlayedAt", "last_played_at")?.let { entry.setLastPlayedAt(index, it) }
                }
                EntryMode.Preference -> {
                    val liked = item.booleanField("isLiked", "is_liked", "liked") ?: false
                    val disliked = item.booleanField("isDisliked", "is_disliked", "disliked") ?: false
                    entry.setPreference(index, liked, disliked)
                }
                EntryMode.PlayCount -> {
                    entry.setPlayCount(
                        index,
                        item.intField("playCount", "play_count")
                            ?: throw LegacyLibraryImportParseException(
                                "Legacy play-count row ${index + 1} is missing a playCount."
                            )
                    )
                    item.longField("lastPlayedAt", "last_played_at")?.let { entry.setLastPlayedAt(index, it) }
                }
            }
        }
    }

    private enum class EntryMode {
        Full,
        Preference,
        PlayCount
    }

    private data class MutableLegacyEntry(
        val themeId: Long,
        var liked: Boolean = false,
        var disliked: Boolean = false,
        var playCount: Int = 0,
        var lastPlayedAt: Long? = null
    ) {
        fun setPreference(index: Int, liked: Boolean, disliked: Boolean) {
            if (liked && disliked) {
                throw LegacyLibraryImportParseException(
                    "Legacy import row ${index + 1} cannot be both liked and disliked."
                )
            }
            this.liked = liked
            this.disliked = disliked
        }

        fun setPlayCount(index: Int, playCount: Int) {
            if (playCount < 0) {
                throw LegacyLibraryImportParseException("Legacy import row ${index + 1} has a negative playCount.")
            }
            this.playCount = playCount
        }

        fun setLastPlayedAt(index: Int, lastPlayedAt: Long) {
            if (lastPlayedAt < 0L) {
                throw LegacyLibraryImportParseException("Legacy import row ${index + 1} has a negative lastPlayedAt.")
            }
            this.lastPlayedAt = lastPlayedAt
        }

        fun toPayloadEntry(): OngakuLegacyLibraryImportEntry? {
            if (!liked && !disliked && playCount == 0) return null
            return OngakuLegacyLibraryImportEntry(
                themeId = themeId,
                liked = liked,
                disliked = disliked,
                playCount = playCount,
                lastPlayedAt = lastPlayedAt
            )
        }
    }
}

private fun Map<String, Any?>.firstList(vararg names: String): List<*>? =
    names.firstNotNullOfOrNull { this[it] as? List<*> }

private fun Map<*, *>.booleanField(vararg names: String): Boolean? =
    names.firstNotNullOfOrNull { name ->
        when (val raw = this[name]) {
            is Boolean -> raw
            is String -> raw.toBooleanStrictOrNull()
            is Number -> when (raw.toInt()) {
                0 -> false
                1 -> true
                else -> null
            }
            else -> null
        }
    }

private fun Map<*, *>.longField(vararg names: String): Long? =
    names.firstNotNullOfOrNull { name -> this[name].asWholeLongOrNull() }

private fun Map<*, *>.intField(vararg names: String): Int? =
    names.firstNotNullOfOrNull { name ->
        val value = this[name].asWholeLongOrNull() ?: return@firstNotNullOfOrNull null
        if (value in Int.MIN_VALUE..Int.MAX_VALUE) value.toInt() else null
    }

private fun Any?.asWholeLongOrNull(): Long? {
    return when (this) {
        is Int -> toLong()
        is Long -> this
        is Double -> if (isFinite() && this % 1.0 == 0.0) toLong() else null
        is Float -> if (isFinite() && this % 1.0f == 0.0f) toLong() else null
        is Number -> toLong()
        is String -> toLongOrNull()
        else -> null
    }
}
