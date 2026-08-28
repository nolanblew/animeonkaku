package com.takeya.animeongaku.ui.library

internal enum class LibraryGridKind {
    PLAYLISTS,
    ANIME
}

/** Keeps compact library browsing dense while adding useful columns on larger displays. */
internal fun libraryGridColumns(widthDp: Int, kind: LibraryGridKind): Int = when (kind) {
    LibraryGridKind.PLAYLISTS -> when {
        widthDp < 600 -> 2
        widthDp < 840 -> 3
        else -> 4
    }

    LibraryGridKind.ANIME -> when {
        widthDp < 600 -> 3
        widthDp < 840 -> 4
        else -> 6
    }
}

internal fun libraryPosterAspectRatio(): Float = 2f / 3f
