package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.repository.LibrarySyncProgress
import com.takeya.animeongaku.data.repository.ThemeMappingProgress

data class SyncState(
    val phase: SyncPhase = SyncPhase.Idle,
    val status: String = "",
    val isRunning: Boolean = false,
    val isPaused: Boolean = false,
    val errorMessage: String? = null,
    val libraryProgress: LibrarySyncProgress? = null,
    val themeProgress: ThemeMappingProgress? = null,
    val fallbackCurrent: Int = 0,
    val fallbackTotal: Int = 0,
    val lastSyncCount: Int = 0,
    val lastThemeCount: Int = 0,
    val unmatchedAnime: List<String> = emptyList()
)

enum class SyncPhase {
    Idle,
    SyncingLibrary,
    MappingThemes,
    FallbackSearch,
    Saving,
    Done,
    Error
}
