package com.takeya.animeongaku.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.takeya.animeongaku.sync.LibraryPullManager
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class LibraryPullWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val libraryPullManager: LibraryPullManager
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = runCatching {
        libraryPullManager.pullIfStale(minIntervalMs = 0L)
        Result.success()
    }.getOrElse {
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "library_pull"
        private const val MAX_ATTEMPTS = 3
    }
}
