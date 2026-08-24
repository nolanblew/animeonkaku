package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistItemRequest
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.OfflineSync
import com.takeya.animeongaku.sync.SyncEngine
import com.takeya.animeongaku.sync.legacyPlaylistEntryId
import javax.inject.Inject
import javax.inject.Singleton

interface PlaylistWriteStore {
    suspend fun createLocalPlaylist(
        name: String,
        entries: List<Long>,
        playlistId: Long? = null,
        isAuto: Boolean = false,
        updatedAt: Long = System.currentTimeMillis()
    ): Long
    suspend fun applyServerPlaylist(playlist: OngakuPlaylistDto)
    suspend fun addEntries(playlistId: Long, themeIds: List<Long>)
    suspend fun renamePlaylist(playlistId: Long, name: String, updatedAt: Long)
    suspend fun tombstonePlaylist(playlistId: Long, updatedAt: Long)
    suspend fun touchPlaylist(playlistId: Long, updatedAt: Long)
    suspend fun playlistById(playlistId: Long): PlaylistEntity?
    suspend fun themeIdsInPlaylist(playlistId: Long): List<Long>
    suspend fun playlistItems(playlistId: Long): List<PlaylistWriteItem> =
        themeIdsInPlaylist(playlistId).map { PlaylistWriteItem(itemType = PlaylistEntryEntity.ITEM_TYPE_THEME, itemId = it) }
    suspend fun addItems(playlistId: Long, items: List<PlaylistWriteItem>) =
        addEntries(playlistId, items.map { it.itemId })
    suspend fun updateDefaultMode(playlistId: Long, defaultMode: String, updatedAt: Long) = Unit
    suspend fun updatePlaybackPolicy(
        playlistId: Long,
        defaultMode: String,
        overrideUserPreference: Boolean,
        updatedAt: Long
    ) = updateDefaultMode(playlistId, defaultMode, updatedAt)
    suspend fun updateItemMode(playlistId: Long, entryId: Long, modeOverride: String?) = Unit
}

data class PlaylistWriteItem(
    val entryId: Long? = null,
    val itemType: String,
    val itemId: Long,
    val modeOverride: String? = null
) {
    init {
        require(itemType == PlaylistEntryEntity.ITEM_TYPE_THEME || itemType == PlaylistEntryEntity.ITEM_TYPE_SONG)
        require(itemType == PlaylistEntryEntity.ITEM_TYPE_THEME || modeOverride == null)
        require(modeOverride == null || modeOverride == "TV_SIZE" || modeOverride == "FULL_SIZE")
    }

    fun toRequest() = OngakuPlaylistItemRequest(entryId?.takeIf { it > 0L }, itemType, itemId, modeOverride)
}

@Singleton
class RoomPlaylistWriteStore @Inject constructor(
    private val playlistDao: PlaylistDao
) : PlaylistWriteStore {
    override suspend fun createLocalPlaylist(
        name: String,
        entries: List<Long>,
        playlistId: Long?,
        isAuto: Boolean,
        updatedAt: Long
    ): Long {
        val insertedPlaylistId = playlistDao.insertPlaylist(
            PlaylistEntity(
                id = playlistId ?: 0L,
                name = name,
                createdAt = updatedAt,
                isAuto = isAuto,
                updatedAt = updatedAt,
                deletedAt = null
            )
        )
        if (entries.isNotEmpty()) {
            playlistDao.insertEntries(
                entries.mapIndexed { index, themeId ->
                    PlaylistEntryEntity(
                        playlistId = insertedPlaylistId,
                        themeId = themeId,
                        orderIndex = index
                    )
                }
            )
        }
        return insertedPlaylistId
    }

    override suspend fun applyServerPlaylist(playlist: OngakuPlaylistDto) {
        playlistDao.insertPlaylist(
            PlaylistEntity(
                id = playlist.id,
                name = playlist.name,
                createdAt = playlist.updatedAt,
                isAuto = playlist.isAuto || playlist.dynamicSpecJson != null,
                defaultMode = playlist.defaultMode,
                overrideUserPreference = playlist.overrideUserPreference,
                updatedAt = playlist.updatedAt,
                deletedAt = playlist.updatedAt.takeIf { playlist.deleted }
            )
        )
        playlistDao.deletePlaylistEntries(playlist.id)
        val typedItems = playlist.items
        if (typedItems.isNotEmpty()) {
            playlistDao.insertEntries(
                typedItems.mapIndexed { index, item ->
                    PlaylistEntryEntity(
                        playlistId = playlist.id,
                        themeId = item.itemId.takeIf { item.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME },
                        orderIndex = index,
                        entryId = item.entryId,
                        itemType = item.itemType,
                        itemId = item.itemId,
                        modeOverride = item.modeOverride
                    )
                }
            )
        } else if (playlist.entries.isNotEmpty()) {
            val occurrences = mutableMapOf<Long, Int>()
            playlistDao.insertEntries(
                playlist.entries.mapIndexed { index, themeId ->
                    val occurrence = occurrences.getOrDefault(themeId, 0)
                    occurrences[themeId] = occurrence + 1
                    PlaylistEntryEntity(
                        playlistId = playlist.id,
                        themeId = themeId,
                        orderIndex = index,
                        entryId = legacyPlaylistEntryId(themeId, occurrence)
                    )
                }
            )
        }
    }

    override suspend fun addEntries(playlistId: Long, themeIds: List<Long>) {
        val count = playlistDao.countEntries(playlistId)
        val entries = themeIds.mapIndexed { index, themeId ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = themeId,
                orderIndex = count + index
            )
        }
        playlistDao.insertEntries(entries)
    }

    override suspend fun renamePlaylist(playlistId: Long, name: String, updatedAt: Long) {
        playlistDao.renamePlaylistWithUpdatedAt(playlistId, name, updatedAt)
    }

    override suspend fun tombstonePlaylist(playlistId: Long, updatedAt: Long) {
        playlistDao.deletePlaylistEntries(playlistId)
        playlistDao.tombstonePlaylist(playlistId, updatedAt, updatedAt)
    }

    override suspend fun touchPlaylist(playlistId: Long, updatedAt: Long) {
        playlistDao.touchPlaylist(playlistId, updatedAt)
    }

    override suspend fun playlistById(playlistId: Long): PlaylistEntity? =
        playlistDao.getPlaylistById(playlistId)

    override suspend fun themeIdsInPlaylist(playlistId: Long): List<Long> =
        playlistDao.getThemeIdsInPlaylist(playlistId)

    override suspend fun playlistItems(playlistId: Long): List<PlaylistWriteItem> =
        playlistDao.getPlaylistEntries(playlistId).map { PlaylistWriteItem(it.entryId, it.itemType, it.itemId, it.modeOverride) }

    override suspend fun addItems(playlistId: Long, items: List<PlaylistWriteItem>) {
        val count = playlistDao.countEntries(playlistId)
        playlistDao.insertEntries(items.mapIndexed { index, item ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = item.itemId.takeIf { item.itemType == PlaylistEntryEntity.ITEM_TYPE_THEME },
                orderIndex = count + index,
                entryId = item.entryId ?: OfflineSync.nextTempId(),
                itemType = item.itemType,
                itemId = item.itemId,
                modeOverride = item.modeOverride
            )
        })
    }

    override suspend fun updateDefaultMode(playlistId: Long, defaultMode: String, updatedAt: Long) =
        playlistDao.updateDefaultMode(playlistId, defaultMode, updatedAt)

    override suspend fun updatePlaybackPolicy(
        playlistId: Long,
        defaultMode: String,
        overrideUserPreference: Boolean,
        updatedAt: Long
    ) = playlistDao.updatePlaybackPolicy(playlistId, defaultMode, overrideUserPreference, updatedAt)

    override suspend fun updateItemMode(playlistId: Long, entryId: Long, modeOverride: String?) =
        playlistDao.updateEntryMode(playlistId, entryId, modeOverride)
}

@Singleton
class ServerPlaylistWriter @Inject constructor(
    private val store: PlaylistWriteStore,
    private val serverSettingsStore: ServerSettingsStore,
    private val syncEngine: SyncEngine
) {
    suspend fun createPlaylist(name: String, entries: List<Long> = emptyList()): Long {
        val opTs = System.currentTimeMillis()
        val id = if (serverSettingsStore.isConfigured) OfflineSync.nextTempId() else null
        val localId = store.createLocalPlaylist(name, entries, playlistId = id, updatedAt = opTs)
        if (serverSettingsStore.isConfigured) {
            syncEngine.enqueuePlaylistCreate(localId, name, entries, opTs = opTs)
            syncEngine.pushPendingWrites()
        }
        return localId
    }

    suspend fun addEntries(playlistId: Long, themeIds: List<Long>) {
        addItems(playlistId, themeIds.map { PlaylistWriteItem(itemType = PlaylistEntryEntity.ITEM_TYPE_THEME, itemId = it) })
    }

    suspend fun addThemeEntries(playlistId: Long, themeIds: List<Long>, modeOverride: String?) {
        addItems(
            playlistId,
            themeIds.map {
                PlaylistWriteItem(
                    itemType = PlaylistEntryEntity.ITEM_TYPE_THEME,
                    itemId = it,
                    modeOverride = modeOverride
                )
            }
        )
    }

    suspend fun addItems(playlistId: Long, items: List<PlaylistWriteItem>) {
        if (items.isEmpty()) return
        requireEditable(playlistId)
        store.addItems(playlistId, items)
        store.touchPlaylist(playlistId, System.currentTimeMillis())
        syncPlaylistItems(playlistId)
    }

    suspend fun createPlaylistWithItems(
        name: String,
        items: List<PlaylistWriteItem>,
        defaultMode: String = "TV_SIZE"
    ): Long {
        require(defaultMode == "TV_SIZE" || defaultMode == "FULL_SIZE")
        val opTs = System.currentTimeMillis()
        val requestedId = if (serverSettingsStore.isConfigured) OfflineSync.nextTempId() else null
        val localId = store.createLocalPlaylist(name, emptyList(), playlistId = requestedId, updatedAt = opTs)
        store.updateDefaultMode(localId, defaultMode, opTs)
        if (items.isNotEmpty()) store.addItems(localId, items)
        if (serverSettingsStore.isConfigured) {
            val storedItems = store.playlistItems(localId)
            syncEngine.enqueuePlaylistCreate(
                localId, name, entries = null, defaultMode = defaultMode,
                items = storedItems.map(PlaylistWriteItem::toRequest), opTs = opTs
            )
            syncEngine.pushPendingWrites()
        }
        return localId
    }

    suspend fun createPlaylistWithThemes(name: String, themeIds: List<Long>, modeOverride: String?): Long =
        createPlaylistWithItems(
            name = name,
            items = themeIds.map {
                PlaylistWriteItem(
                    itemType = PlaylistEntryEntity.ITEM_TYPE_THEME,
                    itemId = it,
                    modeOverride = modeOverride
                )
            }
        )

    suspend fun updateDefaultMode(playlistId: Long, defaultMode: String) {
        val current = store.playlistById(playlistId) ?: return
        updatePlaybackPolicy(playlistId, defaultMode, current.overrideUserPreference)
    }

    suspend fun updateOverrideUserPreference(playlistId: Long, overrideUserPreference: Boolean) {
        val current = store.playlistById(playlistId) ?: return
        updatePlaybackPolicy(playlistId, current.defaultMode, overrideUserPreference)
    }

    private suspend fun updatePlaybackPolicy(
        playlistId: Long,
        defaultMode: String,
        overrideUserPreference: Boolean
    ) {
        require(defaultMode == "TV_SIZE" || defaultMode == "FULL_SIZE")
        val playlist = store.playlistById(playlistId) ?: return
        val opTs = System.currentTimeMillis()
        store.updatePlaybackPolicy(playlistId, defaultMode, overrideUserPreference, opTs)
        if (!serverSettingsStore.isConfigured) return
        if (playlist.isAuto) {
            syncEngine.enqueuePlaylistPlaybackPolicy(playlistId, defaultMode, overrideUserPreference, opTs)
            syncEngine.pushPendingWrites()
        } else {
            syncPlaylistItems(playlistId)
        }
    }

    suspend fun updateItemMode(playlistId: Long, entryId: Long, modeOverride: String?) {
        require(modeOverride == null || modeOverride == "TV_SIZE" || modeOverride == "FULL_SIZE")
        requireEditable(playlistId)
        store.updateItemMode(playlistId, entryId, modeOverride)
        store.touchPlaylist(playlistId, System.currentTimeMillis())
        syncPlaylistItems(playlistId)
    }

    suspend fun renamePlaylist(playlistId: Long, name: String) {
        val opTs = System.currentTimeMillis()
        store.renamePlaylist(playlistId, name, opTs)
        if (!serverSettingsStore.isConfigured) return
        syncEngine.enqueuePlaylistRename(playlistId, name, opTs)
        syncEngine.pushPendingWrites()
    }

    suspend fun deletePlaylist(playlistId: Long) {
        val opTs = System.currentTimeMillis()
        store.tombstonePlaylist(playlistId, opTs)
        if (!serverSettingsStore.isConfigured) return
        syncEngine.enqueuePlaylistDelete(playlistId, opTs)
        syncEngine.pushPendingWrites()
    }

    suspend fun syncPlaylistEntries(playlistId: Long) {
        if (!serverSettingsStore.isConfigured) return
        val playlist = store.playlistById(playlistId) ?: return
        if (playlist.isAuto) return
        val entries = store.themeIdsInPlaylist(playlistId)
        val opTs = System.currentTimeMillis()
        store.touchPlaylist(playlistId, opTs)
        syncEngine.enqueuePlaylistReorder(playlistId, entries, opTs)
        syncEngine.pushPendingWrites()
    }

    suspend fun syncPlaylistItems(playlistId: Long) {
        if (!serverSettingsStore.isConfigured) return
        val playlist = store.playlistById(playlistId) ?: return
        if (playlist.isAuto) return
        val items = store.playlistItems(playlistId)
        val opTs = System.currentTimeMillis()
        store.touchPlaylist(playlistId, opTs)
        syncEngine.enqueuePlaylistItems(
            playlistId,
            playlist.defaultMode,
            playlist.overrideUserPreference,
            items.map(PlaylistWriteItem::toRequest),
            opTs
        )
        syncEngine.pushPendingWrites()
    }

    private suspend fun requireEditable(playlistId: Long) {
        check(store.playlistById(playlistId)?.isAuto != true) { "Auto playlists are read-only" }
    }
}
