package com.takeya.animeongaku.sync

/**
 * The user-visible stages of the first sign-in sync. The initial sync is
 * metadata-only: audio files are cached on the server later by the background
 * download queue, so the app never waits on binary data here.
 */
enum class FirstSyncStep(val stepNumber: Int, val title: String) {
    SyncLibrary(1, "Syncing your anime library"),
    MatchThemes(2, "Matching openings & endings"),
    LoadDevice(3, "Loading your library on this device");

    companion object {
        val totalSteps: Int = entries.size
    }
}

data class FirstSyncProgress(
    val step: FirstSyncStep,
    val message: String
)

fun SyncPhase.toFirstSyncStep(): FirstSyncStep = when (this) {
    SyncPhase.Idle,
    SyncPhase.SyncingLibrary -> FirstSyncStep.SyncLibrary
    SyncPhase.MappingThemes,
    SyncPhase.FallbackSearch,
    SyncPhase.Saving -> FirstSyncStep.MatchThemes
    SyncPhase.Done,
    SyncPhase.Error -> FirstSyncStep.LoadDevice
}
