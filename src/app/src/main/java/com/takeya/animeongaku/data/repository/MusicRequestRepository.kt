package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.remote.MusicRequestApi
import com.takeya.animeongaku.data.remote.OngakuMusicRequestSummaryDto
import javax.inject.Inject
import javax.inject.Singleton

enum class MusicRequestState {
    QUEUED,
    SEARCHING,
    AWAITING_OPERATOR,
    DOWNLOADING,
    PROCESSING,
    COMPLETED,
    COMPLETED_WITH_WARNINGS,
    FAILED,
    CANCELLED,
    UNKNOWN;

    val isTerminal: Boolean
        get() = this in setOf(COMPLETED, COMPLETED_WITH_WARNINGS, FAILED, CANCELLED, UNKNOWN)

    companion object {
        fun fromWire(value: String): MusicRequestState =
            entries.firstOrNull { it.name == value } ?: UNKNOWN
    }
}

data class MusicRequestBatchCounts(
    val queued: Int = 0,
    val searching: Int = 0,
    val awaitingOperator: Int = 0,
    val downloading: Int = 0,
    val processing: Int = 0,
    val completed: Int = 0,
    val completedWithWarnings: Int = 0,
    val failed: Int = 0,
    val cancelled: Int = 0
)

data class MusicRequest(
    val id: String,
    val kitsuId: String,
    val state: MusicRequestState,
    val batchCount: Int,
    val counts: MusicRequestBatchCounts,
    val requiresOperatorAction: Boolean,
    val lastUpdatedAt: String,
    val pollAfterSeconds: Int?
)

interface MusicRequestRepository {
    suspend fun create(kitsuId: String): MusicRequest
    suspend fun get(requestId: String): MusicRequest
    suspend fun latest(kitsuId: String): MusicRequest?
}

@Singleton
class ServerMusicRequestRepository @Inject constructor(
    private val api: MusicRequestApi
) : MusicRequestRepository {
    override suspend fun create(kitsuId: String): MusicRequest =
        requireNotNull(api.create(kitsuId).request) { "Music request response was empty" }.toDomain()

    override suspend fun get(requestId: String): MusicRequest =
        requireNotNull(api.get(requestId).request) { "Music request was not found" }.toDomain()

    override suspend fun latest(kitsuId: String): MusicRequest? =
        api.latest(kitsuId).request?.toDomain()
}

fun OngakuMusicRequestSummaryDto.toDomain(): MusicRequest = MusicRequest(
    id = id,
    kitsuId = kitsuId,
    state = MusicRequestState.fromWire(state),
    batchCount = batchCount.coerceAtLeast(0),
    counts = MusicRequestBatchCounts(
        queued = counts.queued.coerceAtLeast(0),
        searching = counts.searching.coerceAtLeast(0),
        awaitingOperator = counts.awaitingOperator.coerceAtLeast(0),
        downloading = counts.downloading.coerceAtLeast(0),
        processing = counts.processing.coerceAtLeast(0),
        completed = counts.completed.coerceAtLeast(0),
        completedWithWarnings = counts.completedWithWarnings.coerceAtLeast(0),
        failed = counts.failed.coerceAtLeast(0),
        cancelled = counts.cancelled.coerceAtLeast(0)
    ),
    requiresOperatorAction = requiresOperatorAction,
    lastUpdatedAt = lastUpdatedAt,
    pollAfterSeconds = pollAfterSeconds?.coerceIn(1, 60)
)
