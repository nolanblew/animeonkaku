package com.takeya.animeongaku.sync

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PendingWritesFlusher @Inject constructor(
    private val syncEngine: SyncEngine
) {
    suspend fun flushPendingPlays(maxBatchSize: Int = MAX_BATCH_SIZE): Int {
        val result = syncEngine.pushPendingWrites(maxBatchSize)
        return result.playCount + result.opCount
    }

    companion object {
        const val MAX_BATCH_SIZE = 100
    }
}
