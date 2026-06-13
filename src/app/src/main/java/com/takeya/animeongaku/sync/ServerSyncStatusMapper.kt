package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.remote.OngakuSyncStatusResponse

fun OngakuSyncStatusResponse.toSyncState(): SyncState {
    val stateKey = state.uppercase()
    val phaseKey = phase?.uppercase()

    if (stateKey == "FAILED" || stateKey == "CANCELLED") {
        val message = progress["error"]?.toString()?.takeIf { it.isNotBlank() }
            ?: state.lowercase()
        return SyncState(
            phase = SyncPhase.Error,
            status = "Server sync failed: $message",
            isRunning = false,
            errorMessage = "Server sync failed: $message",
            unmatchedAnime = unmatched
        )
    }

    if (stateKey == "DONE") {
        return SyncState(
            phase = SyncPhase.Done,
            status = "Server sync complete",
            isRunning = false,
            unmatchedAnime = unmatched
        )
    }

    if (stateKey == "IDLE") {
        return SyncState(
            phase = SyncPhase.Idle,
            status = "Server sync idle",
            isRunning = false,
            unmatchedAnime = unmatched
        )
    }

    val syncPhase = when (phaseKey) {
        "KITSU_FULL_SYNC",
        "KITSU_DELTA_SYNC",
        "SYNCING_LIBRARY" -> SyncPhase.SyncingLibrary
        "MAP_THEMES",
        "MAPPING_THEMES" -> SyncPhase.MappingThemes
        "FALLBACK_SEARCH" -> SyncPhase.FallbackSearch
        "BACKFILL_SCAN",
        "AUTO_PLAYLIST_REFRESH",
        "SAVING" -> SyncPhase.Saving
        else -> SyncPhase.SyncingLibrary
    }

    return SyncState(
        phase = syncPhase,
        status = syncPhase.serverStatusText(),
        isRunning = stateKey == "RUNNING" || stateKey == "QUEUED",
        unmatchedAnime = unmatched
    )
}

private fun SyncPhase.serverStatusText(): String = when (this) {
    SyncPhase.SyncingLibrary -> "Server sync: syncing library"
    SyncPhase.MappingThemes -> "Server sync: mapping themes"
    SyncPhase.FallbackSearch -> "Server sync: fallback search"
    SyncPhase.Saving -> "Server sync: saving"
    SyncPhase.Done -> "Server sync complete"
    SyncPhase.Error -> "Server sync failed"
    SyncPhase.Idle -> "Server sync idle"
}
