package com.takeya.animeongaku.sync

import androidx.room.withTransaction
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.PendingOpDao
import com.takeya.animeongaku.data.local.PendingOpEntity
import com.takeya.animeongaku.data.local.PendingPlayDao
import com.takeya.animeongaku.data.local.PendingPlayEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuManualAnimeRequest
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistRequest
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton

data class SyncPushResult(
    val opCount: Int,
    val playCount: Int,
    val failed: Boolean = false
)

interface SyncEngineStore {
    suspend fun insertPendingOp(op: PendingOpEntity): Long
    suspend fun deleteSupersededPendingOp(entityType: String, entityKey: String, opType: String)
    suspend fun oldestPendingOps(limit: Int): List<PendingOpEntity>
    suspend fun deletePendingOps(ids: List<Long>)
    suspend fun incrementPendingOpAttempts(id: Long)
    suspend fun remapPlaylistId(tempId: Long, serverPlaylist: OngakuPlaylistDto)
    suspend fun oldestPendingPlays(limit: Int): List<PendingPlayEntity> = emptyList()
    suspend fun deletePendingPlays(ids: List<Long>) = Unit
}

@Singleton
class SyncEngine @Inject constructor(
    private val store: SyncEngineStore,
    private val api: OngakuApi,
    private val settings: ServerSettingsStore,
    moshi: Moshi
) {
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    suspend fun enqueueThemePreference(
        themeId: Long,
        liked: Boolean,
        disliked: Boolean,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_THEME_PREF,
            entityKey = themeId.toString(),
            opType = PendingOpEntity.OP_UPSERT,
            payload = mapOf("liked" to liked, "disliked" to disliked),
            opTs = opTs
        )
    }

    suspend fun enqueuePlaylistCreate(
        playlistId: Long,
        name: String,
        entries: List<Long>,
        dynamicSpecJson: Any? = null,
        dynamicSortJson: Any? = null,
        autoUpdate: Boolean? = null,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_CREATE,
            payload = playlistPayload(name, entries, dynamicSpecJson, dynamicSortJson, autoUpdate),
            opTs = opTs,
            supersede = false
        )
    }

    suspend fun enqueuePlaylistRename(
        playlistId: Long,
        name: String,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_RENAME,
            payload = mapOf("name" to name),
            opTs = opTs
        )
    }

    suspend fun enqueuePlaylistReorder(
        playlistId: Long,
        entries: List<Long>,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_REORDER,
            payload = mapOf("entries" to entries),
            opTs = opTs
        )
    }

    suspend fun enqueueDynamicPlaylistUpsert(
        playlistId: Long,
        name: String?,
        entries: List<Long>?,
        dynamicSpecJson: Any,
        dynamicSortJson: Any?,
        autoUpdate: Boolean,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_UPSERT,
            payload = playlistPayload(name, entries, dynamicSpecJson, dynamicSortJson, autoUpdate),
            opTs = opTs
        )
    }

    suspend fun enqueuePlaylistDelete(playlistId: Long, opTs: Long = System.currentTimeMillis()) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_DELETE,
            payload = emptyMap(),
            opTs = opTs
        )
    }

    suspend fun enqueueLibraryAdd(
        kitsuId: String? = null,
        animeThemesId: Long? = null,
        opTs: Long = System.currentTimeMillis()
    ) {
        val key = kitsuId ?: animeThemesId?.toString() ?: return
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_LIBRARY,
            entityKey = key,
            opType = PendingOpEntity.OP_UPSERT,
            payload = mapOf("kitsuId" to kitsuId, "animeThemesId" to animeThemesId),
            opTs = opTs
        )
    }

    suspend fun enqueueLibraryRemove(kitsuId: String, opTs: Long = System.currentTimeMillis()) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_LIBRARY,
            entityKey = kitsuId,
            opType = PendingOpEntity.OP_DELETE,
            payload = mapOf("kitsuId" to kitsuId),
            opTs = opTs
        )
    }

    suspend fun pushPendingWrites(limit: Int = 100): SyncPushResult {
        if (!settings.isConfigured) return SyncPushResult(opCount = 0, playCount = 0)

        var pushedPlays = 0
        var pushedOps = 0
        var failed = false

        while (pushedPlays < limit) {
            val plays = store.oldestPendingPlays(limit - pushedPlays)
            if (plays.isEmpty()) break
            val accepted = try {
                api.recordPlays(plays.map { OngakuPlayEvent(themeId = it.themeId, playedAt = it.playedAt) })
            } catch (_: Throwable) {
                failed = true
                break
            }
            val acceptedIds = plays.take(accepted.accepted.coerceAtMost(plays.size)).map { it.id }
            if (acceptedIds.isEmpty()) break
            store.deletePendingPlays(acceptedIds)
            pushedPlays += acceptedIds.size
            if (acceptedIds.size < plays.size) break
        }

        while (pushedOps < limit) {
            val op = store.oldestPendingOps(1).firstOrNull() ?: break
            val pushed = runCatching {
                pushOp(op)
            }.isSuccess
            if (!pushed) {
                store.incrementPendingOpAttempts(op.id)
                failed = true
                break
            }
            store.deletePendingOps(listOf(op.id))
            pushedOps += 1
        }

        return SyncPushResult(opCount = pushedOps, playCount = pushedPlays, failed = failed)
    }

    private suspend fun pushOp(op: PendingOpEntity) {
        val payload = parsePayload(op.payloadJson)
        when (op.entityType) {
            PendingOpEntity.ENTITY_THEME_PREF -> pushThemePref(op, payload)
            PendingOpEntity.ENTITY_PLAYLIST -> pushPlaylist(op, payload)
            PendingOpEntity.ENTITY_LIBRARY -> pushLibrary(op, payload)
            else -> error("Unknown pending op entity type ${op.entityType}")
        }
    }

    private suspend fun pushThemePref(op: PendingOpEntity, payload: Map<String, Any?>) {
        api.updateThemePref(
            op.entityKey.toLong(),
            OngakuThemePrefPatch(
                liked = payload["liked"] as? Boolean,
                disliked = payload["disliked"] as? Boolean,
                opTs = op.opTs
            )
        )
    }

    private suspend fun pushPlaylist(op: PendingOpEntity, payload: Map<String, Any?>) {
        val playlistId = op.entityKey.toLong()
        when (op.opType) {
            PendingOpEntity.OP_CREATE -> {
                val response = api.createPlaylist(payload.toPlaylistRequest(op.opTs)).playlist
                store.remapPlaylistId(tempId = playlistId, serverPlaylist = response)
            }
            PendingOpEntity.OP_RENAME,
            PendingOpEntity.OP_REORDER,
            PendingOpEntity.OP_UPSERT -> api.updatePlaylist(playlistId, payload.toPlaylistRequest(op.opTs))
            PendingOpEntity.OP_DELETE -> {
                val response = api.deletePlaylist(playlistId, op.opTs)
                check(response.isSuccessful)
            }
            else -> error("Unknown playlist op ${op.opType}")
        }
    }

    private suspend fun pushLibrary(op: PendingOpEntity, payload: Map<String, Any?>) {
        when (op.opType) {
            PendingOpEntity.OP_UPSERT -> api.addAnime(
                OngakuManualAnimeRequest(
                    kitsuId = payload["kitsuId"] as? String,
                    animeThemesId = (payload["animeThemesId"] as? Number)?.toLong()
                )
            )
            PendingOpEntity.OP_DELETE -> {
                val kitsuId = payload["kitsuId"] as? String ?: op.entityKey
                val response = api.removeAnime(kitsuId)
                check(response.isSuccessful)
            }
            else -> error("Unknown library op ${op.opType}")
        }
    }

    private suspend fun enqueueSuperseding(
        entityType: String,
        entityKey: String,
        opType: String,
        payload: Map<String, Any?>,
        opTs: Long,
        supersede: Boolean = true
    ) {
        if (supersede) {
            store.deleteSupersededPendingOp(entityType, entityKey, opType)
        }
        store.insertPendingOp(
            PendingOpEntity(
                entityType = entityType,
                entityKey = entityKey,
                opType = opType,
                payloadJson = mapAdapter.toJson(payload),
                opTs = opTs,
                createdAt = opTs
            )
        )
    }

    private fun playlistPayload(
        name: String?,
        entries: List<Long>?,
        dynamicSpecJson: Any?,
        dynamicSortJson: Any?,
        autoUpdate: Boolean?
    ): Map<String, Any?> =
        buildMap {
            if (name != null) put("name", name)
            if (entries != null) put("entries", entries)
            if (dynamicSpecJson != null) put("dynamicSpecJson", dynamicSpecJson)
            if (dynamicSortJson != null) put("dynamicSortJson", dynamicSortJson)
            if (autoUpdate != null) put("autoUpdate", autoUpdate)
        }

    private fun parsePayload(json: String): Map<String, Any?> =
        mapAdapter.fromJson(json).orEmpty()

    private fun Map<String, Any?>.toPlaylistRequest(opTs: Long): OngakuPlaylistRequest =
        OngakuPlaylistRequest(
            name = this["name"] as? String,
            entries = (this["entries"] as? List<*>)?.mapNotNull { (it as? Number)?.toLong() },
            dynamicSpecJson = this["dynamicSpecJson"],
            dynamicSortJson = this["dynamicSortJson"],
            autoUpdate = this["autoUpdate"] as? Boolean,
            opTs = opTs
        )
}

@Singleton
class RoomSyncEngineStore @Inject constructor(
    private val database: AppDatabase,
    private val pendingOpDao: PendingOpDao,
    private val pendingPlayDao: PendingPlayDao,
    private val playlistDao: PlaylistDao,
    private val dynamicPlaylistSpecDao: DynamicPlaylistSpecDao
) : SyncEngineStore {
    override suspend fun insertPendingOp(op: PendingOpEntity): Long =
        pendingOpDao.insert(op)

    override suspend fun deleteSupersededPendingOp(entityType: String, entityKey: String, opType: String) {
        pendingOpDao.deleteSuperseded(entityType, entityKey, opType)
    }

    override suspend fun oldestPendingOps(limit: Int): List<PendingOpEntity> =
        pendingOpDao.oldest(limit)

    override suspend fun deletePendingOps(ids: List<Long>) {
        if (ids.isNotEmpty()) pendingOpDao.deleteByIds(ids)
    }

    override suspend fun incrementPendingOpAttempts(id: Long) {
        pendingOpDao.incrementAttempts(id)
    }

    override suspend fun oldestPendingPlays(limit: Int): List<PendingPlayEntity> =
        pendingPlayDao.oldest(limit)

    override suspend fun deletePendingPlays(ids: List<Long>) {
        if (ids.isNotEmpty()) pendingPlayDao.deleteByIds(ids)
    }

    override suspend fun remapPlaylistId(tempId: Long, serverPlaylist: OngakuPlaylistDto) {
        database.withTransaction {
            val local = playlistDao.getPlaylistByIdIncludingDeleted(tempId)
            val entries = serverPlaylist.entries.ifEmpty { playlistDao.getThemeIdsInPlaylist(tempId) }
            val localSpec = dynamicPlaylistSpecDao.getById(tempId)
            val locallyDeletedAt = local?.deletedAt
            playlistDao.insertPlaylist(
                PlaylistEntity(
                    id = serverPlaylist.id,
                    name = serverPlaylist.name,
                    createdAt = local?.createdAt ?: serverPlaylist.updatedAt,
                    isAuto = serverPlaylist.isAuto || serverPlaylist.dynamicSpecJson != null || localSpec != null,
                    gradientSeed = local?.gradientSeed ?: 0,
                    updatedAt = local?.updatedAt?.takeIf { locallyDeletedAt != null } ?: serverPlaylist.updatedAt,
                    deletedAt = locallyDeletedAt
                )
            )
            playlistDao.deletePlaylistEntries(serverPlaylist.id)
            if (locallyDeletedAt == null && entries.isNotEmpty()) {
                playlistDao.insertEntries(
                    entries.mapIndexed { index, themeId ->
                        PlaylistEntryEntity(
                            playlistId = serverPlaylist.id,
                            themeId = themeId,
                            orderIndex = index
                        )
                    }
                )
            }
            if (locallyDeletedAt == null && localSpec != null) {
                dynamicPlaylistSpecDao.upsert(
                    localSpec.copy(
                        playlistId = serverPlaylist.id,
                        serverManaged = true
                    )
                )
            }
            if (tempId != serverPlaylist.id) {
                playlistDao.deletePlaylistEntries(tempId)
                dynamicPlaylistSpecDao.delete(tempId)
                playlistDao.deletePlaylist(tempId)
                pendingOpDao.remapEntityKey(
                    PendingOpEntity.ENTITY_PLAYLIST,
                    tempId.toString(),
                    serverPlaylist.id.toString()
                )
            }
        }
    }
}
