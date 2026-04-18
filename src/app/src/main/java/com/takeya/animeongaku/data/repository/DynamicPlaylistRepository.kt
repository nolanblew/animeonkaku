package com.takeya.animeongaku.data.repository

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.filter.FilterEvaluator
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.SimpleSectionsState
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.PlaylistTrack
import com.takeya.animeongaku.data.local.ThemeDao
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton
class DynamicPlaylistRepository @Inject constructor(
    private val specDao: DynamicPlaylistSpecDao,
    private val playlistDao: PlaylistDao,
    private val evaluator: FilterEvaluator,
    private val themeDao: ThemeDao,
    private val moshi: Moshi
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
        simpleState: SimpleSectionsState? = null
    ): Long = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val id = playlistDao.insertPlaylist(
            PlaylistEntity(
                name = name,
                createdAt = now,
                isAuto = true,
                gradientSeed = Random.nextInt()
            )
        )
        specDao.upsert(
            DynamicPlaylistSpecEntity(
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
        )
        refreshOne(id)
        id
    }

    /** Update the filter (and optionally sort / simple state) on an existing dynamic playlist. Re-evaluates immediately. */
    suspend fun updateDynamic(
        playlistId: Long,
        filter: FilterNode,
        sort: SortSpec? = null,
        simpleState: SimpleSectionsState? = null
    ) = withContext(Dispatchers.IO) {
        val existing = specDao.getById(playlistId) ?: return@withContext
        val updated = existing.copy(
            filterJson = serializeFilter(filter),
            sortJson = sort?.let(::serializeSort) ?: existing.sortJson,
            simpleStateJson = simpleState?.let(::serializeSimpleState) ?: existing.simpleStateJson
        )
        specDao.upsert(updated)
        refreshOne(playlistId)
    }

    /** Delete a dynamic playlist (cascades via FK). */
    suspend fun deleteDynamic(playlistId: Long) = withContext(Dispatchers.IO) {
        playlistDao.deletePlaylist(playlistId)
    }

    /** Re-evaluate and re-populate the playlist entries for one spec. */
    suspend fun refreshOne(playlistId: Long) = withContext(Dispatchers.IO) {
        val spec = specDao.getById(playlistId) ?: return@withContext
        val filter = runCatching { deserializeFilter(spec.filterJson) }
            .getOrElse { return@withContext }
            ?: return@withContext
        val sort = deserializeSortOrDefault(spec.sortJson)
        val themeIds = evaluator.evaluate(filter, sort)
        playlistDao.deletePlaylistEntries(playlistId)
        val entries = themeIds.mapIndexed { index, themeId ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = themeId,
                orderIndex = index
            )
        }
        playlistDao.insertEntries(entries)
        specDao.markEvaluated(playlistId, System.currentTimeMillis(), entries.size)
    }

    /** Observe the spec for a given playlist (null if not dynamic). */
    fun observeSpec(playlistId: Long): Flow<DynamicPlaylistSpecEntity?> =
        specDao.observeById(playlistId)

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
}
