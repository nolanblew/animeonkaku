package com.takeya.animeongaku.media

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One startup read shared by the app controller and externally started media service. */
internal class PlaybackStartupRestoration(
    private val currentQueue: () -> NowPlayingState,
    private val load: suspend () -> RestoredQueueState?,
    private val apply: (RestoredQueueState) -> Unit,
) {
    private val mutex = Mutex()
    private var completed = false

    suspend fun await() = mutex.withLock {
        if (completed) return@withLock
        val initialQueue = currentQueue()
        val restored = load()
        // A user can start or clear a queue while Room/file I/O is suspended. That newer intent
        // wins, even if it has returned to an empty queue by the time the read completes.
        if (restored != null && initialQueue.nowPlayingEntries.isEmpty() && currentQueue() === initialQueue) {
            apply(restored)
        }
        completed = true
    }
}
