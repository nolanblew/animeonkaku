package com.takeya.animeongaku.sync

import javax.inject.Inject
import javax.inject.Singleton

interface ServerUserStateRefresher {
    suspend fun refreshLocalAfterPreferenceWrite()
    suspend fun refreshAfterPreferenceWrite()
}

@Singleton
class LibraryPullServerUserStateRefresher @Inject constructor(
    private val libraryPullManager: LibraryPullManager,
    private val autoPlaylistManager: AutoPlaylistManager,
    private val dynamicPlaylistManager: DynamicPlaylistManager
) : ServerUserStateRefresher {
    override suspend fun refreshLocalAfterPreferenceWrite() {
        autoPlaylistManager.refreshLikedSongs()
        dynamicPlaylistManager.refreshAllAutoSuspend()
    }

    override suspend fun refreshAfterPreferenceWrite() {
        // The write response is server-normalized (mutual exclusion and LWW). Pull the
        // authoritative snapshot so same-millisecond cursor boundaries cannot leave the
        // optimistic reaction state stale.
        val pullResult = runCatching { libraryPullManager.pullNow(forceFull = true) }
        if (pullResult.getOrNull()?.applied != true) {
            refreshLocalAfterPreferenceWrite()
        }
    }
}
