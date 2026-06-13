package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.local.PendingPlayDao
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PendingWritesFlusher @Inject constructor(
    private val pendingPlayDao: PendingPlayDao,
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore
) {
    suspend fun flushPendingPlays(maxBatchSize: Int = MAX_BATCH_SIZE): Int {
        if (!serverSettingsStore.isConfigured) return 0

        val pending = pendingPlayDao.oldest(maxBatchSize)
        if (pending.isEmpty()) return 0

        ongakuApi.recordPlays(
            pending.map { play ->
                OngakuPlayEvent(themeId = play.themeId, playedAt = play.playedAt)
            }
        )
        pendingPlayDao.deleteByIds(pending.map { it.id })
        return pending.size
    }

    companion object {
        const val MAX_BATCH_SIZE = 100
    }
}
