package com.takeya.animeongaku.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.takeya.animeongaku.sync.PendingWritesFlusher
import com.takeya.animeongaku.sync.PendingWritesStillQueuedException
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class PendingWritesFlushWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val pendingWritesFlusher: PendingWritesFlusher
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = runCatching {
        pendingWritesFlusher.flushPendingPlays()
        Result.success()
    }.getOrElse {
        if (it is PendingWritesStillQueuedException) {
            Result.retry()
        } else if (runAttemptCount < MAX_ATTEMPTS) {
            Result.retry()
        } else {
            Result.failure()
        }
    }

    companion object {
        const val UNIQUE_WORK_NAME = "pending_writes_flush"
        private const val MAX_ATTEMPTS = 3
    }
}
