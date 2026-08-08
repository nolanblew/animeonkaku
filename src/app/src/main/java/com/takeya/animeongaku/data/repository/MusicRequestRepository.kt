package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.remote.MusicRequestApi
import com.takeya.animeongaku.data.remote.OngakuMusicRequestStatusDto
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

enum class MusicRequestScope {
    FULL_SONGS,
    EXTRA_MUSIC;

    companion object {
        fun fromWire(value: String): MusicRequestScope =
            entries.firstOrNull { it.name == value } ?: FULL_SONGS
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
    val scope: MusicRequestScope = MusicRequestScope.FULL_SONGS,
    val state: MusicRequestState,
    val active: Boolean = !state.isTerminal,
    val batchCount: Int,
    val fullThemeCount: Int = 0,
    val counts: MusicRequestBatchCounts,
    val requiresOperatorAction: Boolean,
    val lastUpdatedAt: String,
    val pollAfterSeconds: Int?
)

data class MusicRequestScopeStatus(
    val scope: MusicRequestScope,
    val latest: MusicRequest?,
    val active: Boolean,
    val eligibleCount: Int,
    val availableCount: Int,
    val missingCount: Int
)

data class MusicRequestStatus(
    val kitsuId: String,
    val scopes: List<MusicRequestScopeStatus>
) {
    operator fun get(scope: MusicRequestScope): MusicRequestScopeStatus =
        scopes.firstOrNull { it.scope == scope }
            ?: MusicRequestScopeStatus(scope, null, false, 0, 0, 0)
}

interface MusicRequestRepository {
    suspend fun create(kitsuId: String): MusicRequest
    suspend fun request(kitsuId: String, scope: MusicRequestScope): MusicRequest =
        if (scope == MusicRequestScope.FULL_SONGS) create(kitsuId)
        else error("Extra music requests are not supported by this repository")
    suspend fun get(requestId: String): MusicRequest
    suspend fun latest(kitsuId: String): MusicRequest?
    suspend fun status(kitsuId: String): MusicRequestStatus {
        val latest = latest(kitsuId)
        return MusicRequestStatus(
            kitsuId,
            MusicRequestScope.entries.map { scope ->
                val scopedLatest = latest?.takeIf { it.scope == scope }
                MusicRequestScopeStatus(scope, scopedLatest, scopedLatest?.active == true, 0, 0, 0)
            }
        )
    }
}

@Singleton
class ServerMusicRequestRepository @Inject constructor(
    private val api: MusicRequestApi
) : MusicRequestRepository {
    override suspend fun create(kitsuId: String): MusicRequest =
        requireNotNull(api.create(kitsuId).request) { "Music request response was empty" }.toDomain()

    override suspend fun request(kitsuId: String, scope: MusicRequestScope): MusicRequest {
        val envelope = when (scope) {
            MusicRequestScope.FULL_SONGS -> api.createFullSongs(kitsuId)
            MusicRequestScope.EXTRA_MUSIC -> api.createExtraMusic(kitsuId)
        }
        return requireNotNull(envelope.request) { "Music request response was empty" }.toDomain()
    }

    override suspend fun get(requestId: String): MusicRequest =
        requireNotNull(api.get(requestId).request) { "Music request was not found" }.toDomain()

    override suspend fun latest(kitsuId: String): MusicRequest? =
        api.latest(kitsuId).request?.toDomain()

    override suspend fun status(kitsuId: String): MusicRequestStatus = api.status(kitsuId).toDomain()
}

fun OngakuMusicRequestSummaryDto.toDomain(): MusicRequest = MusicRequest(
    id = id,
    kitsuId = kitsuId,
    scope = MusicRequestScope.fromWire(scope),
    state = MusicRequestState.fromWire(state),
    active = active,
    batchCount = batchCount.coerceAtLeast(0),
    fullThemeCount = fullThemeCount.coerceAtLeast(0),
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

fun OngakuMusicRequestStatusDto.toDomain(): MusicRequestStatus = MusicRequestStatus(
    kitsuId = kitsuId,
    scopes = scopes.map { status ->
        val scope = MusicRequestScope.fromWire(status.scope)
        MusicRequestScopeStatus(
            scope = scope,
            latest = status.latest?.toDomain()?.let { latest ->
                if (status.latest.scope == "LEGACY_ALL") latest.copy(scope = scope) else latest
            },
            active = status.active,
            eligibleCount = status.eligibleCount.coerceAtLeast(0),
            availableCount = status.availableCount.coerceAtLeast(0),
            missingCount = status.missingCount.coerceAtLeast(0)
        )
    }
)
