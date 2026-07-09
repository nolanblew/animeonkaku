package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.sync.OfflineSync
import com.takeya.animeongaku.sync.SyncEngine
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
                updatedAt = playlist.updatedAt,
                deletedAt = playlist.updatedAt.takeIf { playlist.deleted }
            )
        )
        playlistDao.deletePlaylistEntries(playlist.id)
        if (playlist.entries.isNotEmpty()) {
            playlistDao.insertEntries(
                playlist.entries.mapIndexed { index, themeId ->
                    PlaylistEntryEntity(
                        playlistId = playlist.id,
                        themeId = themeId,
                        orderIndex = index
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
        if (themeIds.isEmpty()) return
        store.addEntries(playlistId, themeIds)
        store.touchPlaylist(playlistId, System.currentTimeMillis())
        syncPlaylistEntries(playlistId)
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
}
