package com.takeya.animeongaku.data.repository

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.filter.FilterEvaluator
import com.takeya.animeongaku.data.filter.FilterNode
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

    private fun serializeFilter(filter: FilterNode): String {
        return filterAdapter.toJson(filter)
    }

    private fun deserializeFilter(filterJson: String): FilterNode? {
        return filterAdapter.fromJson(filterJson)
    }

    /** Create a new dynamic playlist. Returns the new playlist ID. */
    suspend fun createDynamic(
        name: String,
        filter: FilterNode,
        mode: String,
        createdMode: String
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
                schemaVersion = 1
            )
        )
        refreshOne(id)
        id
    }

    /** Update the filter on an existing dynamic playlist (re-evaluates immediately). */
    suspend fun updateDynamic(playlistId: Long, filter: FilterNode) = withContext(Dispatchers.IO) {
        val existing = specDao.getById(playlistId) ?: return@withContext
        specDao.upsert(existing.copy(filterJson = serializeFilter(filter)))
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
        val themeIds = evaluator.evaluate(filter)
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

    /** Count how many themes match the filter (for live preview). */
    suspend fun previewCount(filter: FilterNode): Int = withContext(Dispatchers.IO) {
        evaluator.count(filter)
    }

    /** Get up to [limit] tracks matching the filter (for live preview). */
    suspend fun previewTracks(filter: FilterNode, limit: Int = 20): List<PlaylistTrack> =
        withContext(Dispatchers.IO) {
            val themeIds = evaluator.evaluate(filter).take(limit)
            if (themeIds.isEmpty()) return@withContext emptyList()
            val themes = themeDao.getByIds(themeIds)
            val themeById = themes.associateBy { it.id }
            themeIds.mapIndexedNotNull { index, id ->
                val theme = themeById[id] ?: return@mapIndexedNotNull null
                PlaylistTrack(theme = theme, orderIndex = index)
            }
        }
}
