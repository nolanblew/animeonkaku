package com.takeya.animeongaku.sync

import javax.inject.Inject
import javax.inject.Singleton

interface LibraryPullSideEffects {
    suspend fun flushPendingWrites()
    suspend fun refreshDynamicPlaylists()
}

@Singleton
class DefaultLibraryPullSideEffects @Inject constructor(
    private val pendingWritesFlusher: PendingWritesFlusher,
    private val dynamicPlaylistManager: DynamicPlaylistManager
) : LibraryPullSideEffects {
    override suspend fun flushPendingWrites() {
        pendingWritesFlusher.flushPendingPlays()
    }

    override suspend fun refreshDynamicPlaylists() {
        dynamicPlaylistManager.refreshAllAutoSuspend()
    }
}
