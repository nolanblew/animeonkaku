package com.takeya.animeongaku.data.filter

/**
 * Attributes that can be used as a dynamic-playlist sort key. Each attribute
 * carries a logical [valueKind] so the UI can render type-aware direction
 * labels (e.g. "Newest first" for dates vs "A -> Z" for strings).
 */
enum class SortAttribute(val valueKind: SortValueKind) {
    TITLE(SortValueKind.STRING),
    ARTIST(SortValueKind.STRING),
    ANIME_TITLE(SortValueKind.STRING),
    THEME_TYPE(SortValueKind.THEME_TYPE),
    AIRED_DATE(SortValueKind.DATE),
    WATCHED_DATE(SortValueKind.DATE),
    AVERAGE_RATING(SortValueKind.NUMBER),
    MY_RATING(SortValueKind.NUMBER),
    PLAY_COUNT(SortValueKind.NUMBER),
    LAST_PLAYED(SortValueKind.DATE),
    LIKED(SortValueKind.BOOLEAN),
    DOWNLOADED(SortValueKind.BOOLEAN),
    RANDOM(SortValueKind.RANDOM)
}

/** Logical value type for a [SortAttribute], used to choose UI affordances. */
enum class SortValueKind {
    STRING,
    NUMBER,
    DATE,
    BOOLEAN,
    /** Opening/ending rank + sequence number, not a raw string. */
    THEME_TYPE,
    /** Deterministic shuffle; direction is ignored. */
    RANDOM
}

enum class SortDirection { ASC, DESC }

data class SortKey(
    val attribute: SortAttribute,
    val direction: SortDirection = SortDirection.ASC
)

data class SortSpec(val keys: List<SortKey>) {
    companion object {
        const val MAX_KEYS = 5

        /** Default sort applied to every newly-created dynamic playlist. */
        val DEFAULT: SortSpec = SortSpec(
            listOf(
                SortKey(SortAttribute.WATCHED_DATE, SortDirection.DESC),
                SortKey(SortAttribute.TITLE, SortDirection.ASC)
            )
        )
    }
}
