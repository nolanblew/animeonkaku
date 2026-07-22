package com.takeya.animeongaku.sync

import androidx.room.withTransaction
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PendingOpDao
import com.takeya.animeongaku.data.local.PendingOpEntity
import com.takeya.animeongaku.data.local.PendingPlayDao
import com.takeya.animeongaku.data.local.PendingPlayEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuManualAnimeRequest
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistRequest
import com.takeya.animeongaku.data.remote.OngakuPlaylistItemRequest
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.remote.OngakuMusicApi
import com.takeya.animeongaku.data.remote.OngakuSongPrefPatch
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.data.auth.SessionStateManager
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
    suspend fun isAutoDynamicPlaylist(playlistId: Long): Boolean = false
    suspend fun oldestPendingPlays(limit: Int): List<PendingPlayEntity> = emptyList()
    suspend fun deletePendingPlays(ids: List<Long>) = Unit
}

@Singleton
class SyncEngine @Inject constructor(
    private val store: SyncEngineStore,
    private val api: OngakuApi,
    private val settings: ServerSettingsStore,
    private val sessionStateManager: SessionStateManager,
    moshi: Moshi,
    private val musicApi: OngakuMusicApi? = null
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
        enqueueThemePreference(
            UserPreferenceEntity(themeId, liked, disliked),
            opTs
        )
    }

    suspend fun enqueueThemePreference(
        preference: UserPreferenceEntity,
        opTs: Long = preference.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_THEME_PREF,
            entityKey = preference.themeId.toString(),
            opType = PendingOpEntity.OP_UPSERT,
            payload = mapOf(
                "liked" to preference.isLiked,
                "disliked" to preference.isDisliked,
                "dislikedTvSize" to preference.isDislikedTvSize,
                "dislikedFullSize" to preference.isDislikedFullSize
            ),
            opTs = opTs
        )
    }

    suspend fun enqueueSongPreference(
        preference: SongPreferenceEntity,
        opTs: Long = preference.updatedAt.takeIf { it > 0L } ?: System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_SONG_PREF,
            entityKey = preference.songId.toString(),
            opType = PendingOpEntity.OP_UPSERT,
            payload = mapOf("liked" to preference.isLiked, "disliked" to preference.isDisliked),
            opTs = opTs
        )
    }

    suspend fun enqueuePlaylistCreate(
        playlistId: Long,
        name: String,
        entries: List<Long>?,
        dynamicSpecJson: Any? = null,
        dynamicSortJson: Any? = null,
        autoUpdate: Boolean? = null,
        defaultMode: String? = null,
        items: List<OngakuPlaylistItemRequest>? = null,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_CREATE,
            payload = playlistPayload(name, entries, dynamicSpecJson, dynamicSortJson, autoUpdate).toMutableMap().apply {
                if (defaultMode != null) put("defaultMode", defaultMode)
                if (items != null) put("items", items.map { mapOf(
                    "entryId" to it.entryId, "itemType" to it.itemType, "itemId" to it.itemId, "modeOverride" to it.modeOverride
                ) })
            },
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

    suspend fun enqueuePlaylistItems(
        playlistId: Long,
        defaultMode: String,
        items: List<OngakuPlaylistItemRequest>,
        opTs: Long = System.currentTimeMillis()
    ) {
        enqueueSuperseding(
            entityType = PendingOpEntity.ENTITY_PLAYLIST,
            entityKey = playlistId.toString(),
            opType = PendingOpEntity.OP_REORDER,
            payload = mapOf(
                "defaultMode" to defaultMode,
                // Keep the legacy THEME-only projection for older servers/clients while the
                // typed list remains authoritative for mixed playlists and entry policy.
                "entries" to items.filter { it.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME }.map { it.itemId },
                "items" to items.map { item ->
                    mapOf(
                        "entryId" to item.entryId,
                        "itemType" to item.itemType,
                        "itemId" to item.itemId,
                        "modeOverride" to item.modeOverride
                    )
                }
            ),
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
        if (!sessionStateManager.isOnlineEnabled()) return SyncPushResult(opCount = 0, playCount = 0)
        if (!settings.isConfigured) return SyncPushResult(opCount = 0, playCount = 0)

        var pushedPlays = 0
        var pushedOps = 0
        var failed = false

        while (pushedPlays < limit) {
            val plays = store.oldestPendingPlays(limit - pushedPlays)
            if (plays.isEmpty()) break
            // Typed events must never be sent to the legacy endpoint: SONG is not a
            // legacy identity, and clientEventId is what makes a retry idempotent.
            val typedPlays = plays.filter { it.clientEventId != null }
            val batch = if (typedPlays.isNotEmpty()) typedPlays else plays
            val accepted = try {
                if (typedPlays.isNotEmpty()) {
                    val music = musicApi ?: error("Typed play API is unavailable")
                    music.recordActualPlays(typedPlays.map {
                    com.takeya.animeongaku.data.remote.OngakuActualPlayEvent(
                        clientEventId = requireNotNull(it.clientEventId),
                        itemType = it.itemType,
                        itemId = it.itemId,
                        actualMode = it.actualMode,
                        playedAt = it.playedAt
                    )
                    })
                } else {
                    api.recordPlays(batch.map { OngakuPlayEvent(themeId = it.themeId, playedAt = it.playedAt) })
                }
            } catch (_: Throwable) {
                failed = true
                break
            }
            // MC-S11 accepts idempotent UUID replays without counting a newly inserted
            // event. A successful typed request therefore acknowledges every UUID posted.
            val acceptedIds = if (typedPlays.isNotEmpty()) {
                batch.map { it.id }
            } else {
                batch.take(accepted.accepted.coerceAtMost(batch.size)).map { it.id }
            }
            if (acceptedIds.isEmpty()) break
            store.deletePendingPlays(acceptedIds)
            pushedPlays += acceptedIds.size
            if (acceptedIds.size < batch.size) break
        }

        val blockedEntities = mutableSetOf<Pair<String, String>>()
        while (pushedOps < limit) {
            val op = store.oldestPendingOps(limit)
                .firstOrNull { (it.entityType to it.entityKey) !in blockedEntities }
                ?: break

            val pushed = runCatching {
                pushOp(op)
            }.isSuccess
            if (!pushed) {
                store.incrementPendingOpAttempts(op.id)
                blockedEntities += op.entityType to op.entityKey
                failed = true
                continue
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
            PendingOpEntity.ENTITY_SONG_PREF -> pushSongPref(op, payload)
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
                dislikedTvSize = payload["dislikedTvSize"] as? Boolean,
                dislikedFullSize = payload["dislikedFullSize"] as? Boolean,
                opTs = op.opTs
            )
        )
    }

    private suspend fun pushSongPref(op: PendingOpEntity, payload: Map<String, Any?>) {
        requireNotNull(musicApi) { "Song preference API is unavailable" }.updateSongPref(
            op.entityKey.toLong(),
            OngakuSongPrefPatch(
                liked = payload["liked"] as? Boolean,
                disliked = payload["disliked"] as? Boolean,
                opTs = op.opTs
            )
        )
    }

    private suspend fun pushPlaylist(op: PendingOpEntity, payload: Map<String, Any?>) {
        val playlistId = op.entityKey.toLong()
        if (op.opType == PendingOpEntity.OP_REORDER && store.isAutoDynamicPlaylist(playlistId)) {
            return
        }
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
            if (entries != null && !(dynamicSpecJson != null && autoUpdate != false)) {
                put("entries", entries)
            }
            if (dynamicSpecJson != null) put("dynamicSpecJson", dynamicSpecJson)
            if (dynamicSortJson != null) put("dynamicSortJson", dynamicSortJson)
            if (autoUpdate != null) put("autoUpdate", autoUpdate)
        }

    private fun parsePayload(json: String): Map<String, Any?> =
        mapAdapter.fromJson(json).orEmpty()

    private fun Map<String, Any?>.toPlaylistRequest(opTs: Long): OngakuPlaylistRequest {
        val dynamicSpec = this["dynamicSpecJson"]
        val autoUpdate = this["autoUpdate"] as? Boolean
        val serverOwnsEntries = dynamicSpec != null && autoUpdate != false
        return OngakuPlaylistRequest(
            name = this["name"] as? String,
            defaultMode = this["defaultMode"] as? String,
            entries = if (serverOwnsEntries) {
                null
            } else {
                (this["entries"] as? List<*>)?.mapNotNull { (it as? Number)?.toLong() }
            },
            items = if (serverOwnsEntries) null else (this["items"] as? List<*>)?.mapNotNull { raw ->
                val item = raw as? Map<*, *> ?: return@mapNotNull null
                val itemType = item["itemType"] as? String ?: return@mapNotNull null
                if (itemType != PlaylistEntryEntity.ITEM_TYPE_THEME && itemType != PlaylistEntryEntity.ITEM_TYPE_SONG) return@mapNotNull null
                OngakuPlaylistItemRequest(
                    entryId = (item["entryId"] as? Number)?.toLong(),
                    itemType = itemType,
                    itemId = (item["itemId"] as? Number)?.toLong() ?: return@mapNotNull null,
                    modeOverride = (item["modeOverride"] as? String)?.takeIf { itemType == PlaylistEntryEntity.ITEM_TYPE_THEME }
                )
            },
            dynamicSpecJson = dynamicSpec,
            dynamicSortJson = this["dynamicSortJson"],
            autoUpdate = autoUpdate,
            opTs = opTs
        )
    }
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

    override suspend fun isAutoDynamicPlaylist(playlistId: Long): Boolean =
        dynamicPlaylistSpecDao.getById(playlistId)?.mode == "AUTO"

    override suspend fun oldestPendingPlays(limit: Int): List<PendingPlayEntity> =
        pendingPlayDao.oldest(limit)

    override suspend fun deletePendingPlays(ids: List<Long>) {
        if (ids.isNotEmpty()) pendingPlayDao.deleteByIds(ids)
    }

    override suspend fun remapPlaylistId(tempId: Long, serverPlaylist: OngakuPlaylistDto) {
        database.withTransaction {
            val local = playlistDao.getPlaylistByIdIncludingDeleted(tempId)
            val localSpec = dynamicPlaylistSpecDao.getById(tempId)
            val serverItems = serverPlaylist.items
            val localItems = playlistDao.getPlaylistEntries(tempId)
            val locallyDeletedAt = local?.deletedAt
            playlistDao.insertPlaylist(
                PlaylistEntity(
                    id = serverPlaylist.id,
                    name = serverPlaylist.name,
                    createdAt = local?.createdAt ?: serverPlaylist.updatedAt,
                    isAuto = serverPlaylist.isAuto || serverPlaylist.dynamicSpecJson != null,
                    gradientSeed = local?.gradientSeed ?: 0,
                    defaultMode = serverPlaylist.defaultMode,
                    updatedAt = local?.updatedAt?.takeIf { locallyDeletedAt != null } ?: serverPlaylist.updatedAt,
                    deletedAt = locallyDeletedAt
                )
            )
            playlistDao.deletePlaylistEntries(serverPlaylist.id)
            if (locallyDeletedAt == null && (serverItems.isNotEmpty() || serverPlaylist.entries.isNotEmpty() || localItems.isNotEmpty())) {
                playlistDao.insertEntries(
                    when {
                        serverItems.isNotEmpty() -> serverItems.mapIndexed { index, item -> PlaylistEntryEntity(
                            playlistId = serverPlaylist.id,
                            themeId = item.itemId.takeIf { item.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME },
                            orderIndex = index, entryId = item.entryId, itemType = item.itemType,
                            itemId = item.itemId, modeOverride = item.modeOverride
                        ) }
                        serverPlaylist.entries.isNotEmpty() -> {
                            val occurrences = mutableMapOf<Long, Int>()
                            serverPlaylist.entries.mapIndexed { index, themeId ->
                                val occurrence = occurrences.getOrDefault(themeId, 0)
                                occurrences[themeId] = occurrence + 1
                                PlaylistEntryEntity(
                                    playlistId = serverPlaylist.id,
                                    themeId = themeId,
                                    orderIndex = index,
                                    entryId = legacyPlaylistEntryId(themeId, occurrence)
                                )
                            }
                        }
                        else -> localItems.map { it.copy(playlistId = serverPlaylist.id) }
                    }
                )
            }
            val remappedSpec = remappedDynamicSpec(localSpec, serverPlaylist)
            if (locallyDeletedAt == null && remappedSpec != null) {
                dynamicPlaylistSpecDao.upsert(remappedSpec)
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

internal fun remappedDynamicSpec(
    localSpec: DynamicPlaylistSpecEntity?,
    serverPlaylist: OngakuPlaylistDto
): DynamicPlaylistSpecEntity? {
    if (localSpec == null || serverPlaylist.dynamicSpecJson == null) return null
    return localSpec.copy(
        playlistId = serverPlaylist.id,
        mode = if (serverPlaylist.autoUpdate) "AUTO" else "SNAPSHOT",
        serverManaged = serverPlaylist.autoUpdate
    )
}
