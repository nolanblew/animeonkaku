package com.takeya.animeongaku.data.repository

import androidx.room.withTransaction
import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.data.filter.FilterEvaluator
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.SimpleSectionsState
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.local.AppDatabase
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.sync.OfflineSync
import com.takeya.animeongaku.sync.SyncEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton
class DynamicPlaylistRepository @Inject constructor(
    private val database: AppDatabase,
    private val specDao: DynamicPlaylistSpecDao,
    private val playlistDao: PlaylistDao,
    private val evaluator: FilterEvaluator,
    private val themeDao: ThemeDao,
    private val moshi: Moshi,
    private val serverSettingsStore: ServerSettingsStore,
    private val syncEngine: SyncEngine
) {
    private val filterAdapter: JsonAdapter<FilterNode> by lazy {
        moshi.adapter(FilterNode::class.java)
    }

    private val sortAdapter: JsonAdapter<SortSpec> by lazy {
        moshi.adapter(SortSpec::class.java)
    }

    private val simpleStateAdapter: JsonAdapter<SimpleSectionsState> by lazy {
        moshi.adapter(SimpleSectionsState::class.java)
    }
    private val anyAdapter: JsonAdapter<Any> by lazy {
        moshi.adapter(Any::class.java)
    }

    private fun serializeFilter(filter: FilterNode): String = filterAdapter.toJson(filter)

    private fun deserializeFilter(filterJson: String): FilterNode? = filterAdapter.fromJson(filterJson)

    private fun serializeSort(sort: SortSpec): String = sortAdapter.toJson(sort)

    /** Decode a stored sort spec, falling back to [SortSpec.DEFAULT] on null or parse failure. */
    private fun deserializeSortOrDefault(sortJson: String?): SortSpec {
        if (sortJson == null) return SortSpec.DEFAULT
        return runCatching { sortAdapter.fromJson(sortJson) }
            .getOrNull()
            ?: SortSpec.DEFAULT
    }

    private fun serializeSimpleState(state: SimpleSectionsState): String =
        simpleStateAdapter.toJson(state)

    private fun deserializeSimpleState(json: String?): SimpleSectionsState? {
        if (json == null) return null
        return runCatching { simpleStateAdapter.fromJson(json) }.getOrNull()
    }

    /** Create a new dynamic playlist. Returns the new playlist ID. */
    suspend fun createDynamic(
        name: String,
        filter: FilterNode,
        mode: String,
        createdMode: String,
        sort: SortSpec = SortSpec.DEFAULT,
        simpleState: SimpleSectionsState? = null,
        defaultMode: String = "TV_SIZE",
        overrideUserPreference: Boolean = false
    ): Long = withContext(Dispatchers.IO) {
        require(defaultMode == "TV_SIZE" || defaultMode == "FULL_SIZE")
        val now = System.currentTimeMillis()
        val localId = if (serverSettingsStore.isConfigured) OfflineSync.nextTempId() else 0L
        val id = playlistDao.insertPlaylist(
            PlaylistEntity(
                id = localId,
                name = name,
                createdAt = now,
                isAuto = true,
                gradientSeed = Random.nextInt(),
                defaultMode = defaultMode,
                overrideUserPreference = overrideUserPreference,
                updatedAt = now,
                deletedAt = null
            )
        )
        val spec = DynamicPlaylistSpecEntity(
                playlistId = id,
                filterJson = serializeFilter(filter),
                mode = mode,
                createdMode = createdMode,
                lastEvaluatedAt = 0L,
                lastResultCount = 0,
                schemaVersion = 1,
                sortJson = serializeSort(sort),
                simpleStateJson = simpleState?.let(::serializeSimpleState)
        )
        specDao.upsert(spec)
        refreshOne(id)
        if (serverSettingsStore.isConfigured) {
            val autoUpdate = spec.mode == "AUTO"
            syncEngine.enqueuePlaylistCreate(
                playlistId = id,
                name = name,
                entries = if (autoUpdate) null else playlistDao.getThemeIdsInPlaylist(id),
                dynamicSpecJson = spec.toServerSpecPayload(),
                dynamicSortJson = spec.sortJson?.let(::parseJson),
                autoUpdate = autoUpdate,
                defaultMode = defaultMode,
                overrideUserPreference = overrideUserPreference,
                opTs = now
            )
            syncEngine.pushPendingWrites()
        }
        id
    }

    /** Update the filter (and optionally sort / simple state) on an existing dynamic playlist. Re-evaluates immediately. */
    suspend fun updateDynamic(
        playlistId: Long,
        name: String,
        filter: FilterNode,
        mode: String,
        createdMode: String,
        sort: SortSpec,
        simpleState: SimpleSectionsState?,
        defaultMode: String,
        overrideUserPreference: Boolean
    ) = withContext(Dispatchers.IO) {
        require(defaultMode == "TV_SIZE" || defaultMode == "FULL_SIZE")
        require(mode == "AUTO" || mode == "SNAPSHOT")
        val existing = specDao.getById(playlistId) ?: return@withContext
        val updated = existing.copy(
            filterJson = serializeFilter(filter),
            mode = mode,
            createdMode = createdMode,
            sortJson = serializeSort(sort),
            simpleStateJson = simpleState?.let(::serializeSimpleState),
            serverManaged = serverSettingsStore.isConfigured && mode == "AUTO"
        )
        specDao.upsert(updated)
        val opTs = System.currentTimeMillis()
        playlistDao.updateDynamicPlaylistMetadata(
            playlistId,
            name,
            defaultMode,
            overrideUserPreference,
            opTs
        )
        if (!updated.serverManaged) {
            refreshOne(playlistId)
        }
        if (serverSettingsStore.isConfigured) {
            val autoUpdate = updated.mode == "AUTO"
            syncEngine.enqueueDynamicPlaylistUpsert(
                playlistId = playlistId,
                name = name,
                entries = if (autoUpdate) null else playlistDao.getThemeIdsInPlaylist(playlistId),
                dynamicSpecJson = updated.toServerSpecPayload(),
                dynamicSortJson = updated.sortJson?.let(::parseJson),
                autoUpdate = autoUpdate,
                defaultMode = defaultMode,
                overrideUserPreference = overrideUserPreference,
                opTs = opTs
            )
            syncEngine.pushPendingWrites()
        }
    }

    /** Delete a dynamic playlist (cascades via FK). */
    suspend fun deleteDynamic(playlistId: Long) = withContext(Dispatchers.IO) {
        val opTs = System.currentTimeMillis()
        playlistDao.deletePlaylistEntries(playlistId)
        playlistDao.tombstonePlaylist(playlistId, opTs, opTs)
        if (serverSettingsStore.isConfigured) {
            syncEngine.enqueuePlaylistDelete(playlistId, opTs)
            syncEngine.pushPendingWrites()
        }
    }

    /** Re-evaluate and re-populate the playlist entries for one spec. */
    suspend fun refreshOne(playlistId: Long) = withContext(Dispatchers.IO) {
        val spec = specDao.getById(playlistId) ?: return@withContext
        if (spec.serverManaged) return@withContext
        val startedPlaylist = playlistDao.getPlaylistByIdIncludingDeleted(playlistId) ?: return@withContext
        val filter = runCatching { deserializeFilter(spec.filterJson) }
            .getOrElse { return@withContext }
            ?: return@withContext
        val sort = deserializeSortOrDefault(spec.sortJson)
        val themeIds = evaluator.evaluate(filter, sort)
        val entries = themeIds.mapIndexed { index, themeId ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = themeId,
                orderIndex = index
            )
        }
        database.withTransaction {
            val latestSpec = specDao.getById(playlistId) ?: return@withTransaction
            val latestPlaylist = playlistDao.getPlaylistByIdIncludingDeleted(playlistId)
                ?: return@withTransaction
            if (!shouldApplyDynamicRefresh(startedPlaylist.updatedAt, latestPlaylist, latestSpec)) {
                return@withTransaction
            }
            playlistDao.deletePlaylistEntries(playlistId)
            playlistDao.insertEntries(entries)
            specDao.markEvaluated(playlistId, System.currentTimeMillis(), entries.size)
        }
    }

    /** Observe the spec for a given playlist (null if not dynamic). */
    fun observeSpec(playlistId: Long): Flow<DynamicPlaylistSpecEntity?> =
        specDao.observeById(playlistId)

    fun observePlaylist(playlistId: Long): Flow<PlaylistEntity?> =
        playlistDao.observePlaylist(playlistId)

    /** Decode a persisted spec's sort spec, falling back to the default. */
    fun decodeSort(entity: DynamicPlaylistSpecEntity): SortSpec =
        deserializeSortOrDefault(entity.sortJson)

    /** Decode a persisted spec's simple state, returning null for advanced playlists or legacy rows. */
    fun decodeSimpleState(entity: DynamicPlaylistSpecEntity): SimpleSectionsState? =
        deserializeSimpleState(entity.simpleStateJson)

    /** Decode the filter tree from a persisted spec. Returns null on parse failure. */
    fun decodeFilter(entity: DynamicPlaylistSpecEntity): FilterNode? =
        runCatching { deserializeFilter(entity.filterJson) }.getOrNull()

    /** Count how many themes match the filter (for live preview). */
    suspend fun previewCount(filter: FilterNode): Int = withContext(Dispatchers.IO) {
        evaluator.count(filter)
    }

    /** Get up to [limit] tracks matching the filter, ordered by [sort] (for live preview). */
    suspend fun previewTracks(
        filter: FilterNode,
        sort: SortSpec = SortSpec.DEFAULT,
        limit: Int = 20
    ): List<PlaylistTrack> =
        withContext(Dispatchers.IO) {
            val themeIds = evaluator.evaluate(filter, sort).take(limit)
            if (themeIds.isEmpty()) return@withContext emptyList()
            val themes = themeDao.getByIds(themeIds)
            val themeById = themes.associateBy { it.id }
            themeIds.mapIndexedNotNull { index, id ->
                val theme = themeById[id] ?: return@mapIndexedNotNull null
                PlaylistTrack(theme = theme, orderIndex = index)
            }
        }

    private fun DynamicPlaylistSpecEntity.toServerSpecPayload(): Map<String, Any?> =
        buildMap {
            put("filterJson", parseJson(filterJson))
            put("mode", mode)
            put("createdMode", createdMode)
            put("schemaVersion", schemaVersion)
            sortJson?.let { put("sortJson", parseJson(it)) }
            simpleStateJson?.let { put("simpleStateJson", parseJson(it)) }
        }

    private fun parseJson(json: String): Any? =
        runCatching { anyAdapter.fromJson(json) }.getOrNull()
}

internal fun shouldApplyDynamicRefresh(
    startedPlaylistUpdatedAt: Long,
    latestPlaylist: PlaylistEntity,
    latestSpec: DynamicPlaylistSpecEntity
): Boolean =
    !latestSpec.serverManaged && latestPlaylist.updatedAt == startedPlaylistUpdatedAt
