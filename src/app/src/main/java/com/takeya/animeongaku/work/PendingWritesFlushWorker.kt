package com.takeya.animeongaku.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.takeya.animeongaku.data.local.PendingPlayDao
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.server.ServerSettingsStore
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class PendingWritesFlushWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val pendingPlayDao: PendingPlayDao,
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = runCatching {
        if (!serverSettingsStore.isConfigured) return@runCatching Result.success()

        val pending = pendingPlayDao.oldest(MAX_BATCH_SIZE)
        if (pending.isEmpty()) return@runCatching Result.success()

        ongakuApi.recordPlays(
            pending.map { play ->
                OngakuPlayEvent(themeId = play.themeId, playedAt = play.playedAt)
            }
        )
        pendingPlayDao.deleteByIds(pending.map { it.id })
        Result.success()
    }.getOrElse {
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.failure()
    }

    companion object {
        const val UNIQUE_WORK_NAME = "pending_writes_flush"
        private const val MAX_BATCH_SIZE = 100
        private const val MAX_ATTEMPTS = 3
    }
}
