package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlaylistDto
import com.takeya.animeongaku.data.remote.OngakuPlaylistRequest
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton

interface PlaylistWriteStore {
    suspend fun createLocalPlaylist(name: String, entries: List<Long>): Long
    suspend fun applyServerPlaylist(playlist: OngakuPlaylistDto)
    suspend fun addEntries(playlistId: Long, themeIds: List<Long>)
    suspend fun renamePlaylist(playlistId: Long, name: String)
    suspend fun deletePlaylist(playlistId: Long)
    suspend fun playlistById(playlistId: Long): PlaylistEntity?
    suspend fun themeIdsInPlaylist(playlistId: Long): List<Long>
}

@Singleton
class RoomPlaylistWriteStore @Inject constructor(
    private val playlistDao: PlaylistDao
) : PlaylistWriteStore {
    override suspend fun createLocalPlaylist(name: String, entries: List<Long>): Long {
        val playlistId = playlistDao.insertPlaylist(
            PlaylistEntity(name = name, createdAt = System.currentTimeMillis())
        )
        if (entries.isNotEmpty()) {
            playlistDao.insertEntries(
                entries.mapIndexed { index, themeId ->
                    PlaylistEntryEntity(
                        playlistId = playlistId,
                        themeId = themeId,
                        orderIndex = index
                    )
                }
            )
        }
        return playlistId
    }

    override suspend fun applyServerPlaylist(playlist: OngakuPlaylistDto) {
        playlistDao.insertPlaylist(
            PlaylistEntity(
                id = playlist.id,
                name = playlist.name,
                createdAt = playlist.updatedAt,
                isAuto = playlist.isAuto
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

    override suspend fun renamePlaylist(playlistId: Long, name: String) {
        playlistDao.renamePlaylist(playlistId, name)
    }

    override suspend fun deletePlaylist(playlistId: Long) {
        playlistDao.deletePlaylistEntries(playlistId)
        playlistDao.deletePlaylist(playlistId)
    }

    override suspend fun playlistById(playlistId: Long): PlaylistEntity? =
        playlistDao.getPlaylistById(playlistId)

    override suspend fun themeIdsInPlaylist(playlistId: Long): List<Long> =
        playlistDao.getThemeIdsInPlaylist(playlistId)
}

@Singleton
class ServerPlaylistWriter @Inject constructor(
    private val store: PlaylistWriteStore,
    private val ongakuApi: OngakuApi,
    private val serverSettingsStore: ServerSettingsStore
) {
    suspend fun createPlaylist(name: String, entries: List<Long> = emptyList()): Long {
        if (!serverSettingsStore.isConfigured) {
            return store.createLocalPlaylist(name, entries)
        }

        val serverPlaylist = runCatching {
            ongakuApi.createPlaylist(
                OngakuPlaylistRequest(
                    name = name,
                    entries = entries
                )
            ).playlist
        }.getOrElse {
            return store.createLocalPlaylist(name, entries)
        }

        store.applyServerPlaylist(serverPlaylist)
        return serverPlaylist.id
    }

    suspend fun addEntries(playlistId: Long, themeIds: List<Long>) {
        if (themeIds.isEmpty()) return
        store.addEntries(playlistId, themeIds)
        syncPlaylistEntries(playlistId)
    }

    suspend fun renamePlaylist(playlistId: Long, name: String) {
        store.renamePlaylist(playlistId, name)
        if (!serverSettingsStore.isConfigured) return
        runCatching {
            ongakuApi.updatePlaylist(
                playlistId,
                OngakuPlaylistRequest(name = name)
            )
        }
    }

    suspend fun deletePlaylist(playlistId: Long) {
        store.deletePlaylist(playlistId)
        if (!serverSettingsStore.isConfigured) return
        runCatching {
            ongakuApi.deletePlaylist(playlistId)
        }
    }

    suspend fun syncPlaylistEntries(playlistId: Long) {
        if (!serverSettingsStore.isConfigured) return
        val playlist = store.playlistById(playlistId) ?: return
        if (playlist.isAuto) return
        val entries = store.themeIdsInPlaylist(playlistId)
        runCatching {
            ongakuApi.updatePlaylist(
                playlistId,
                OngakuPlaylistRequest(entries = entries)
            )
        }
    }
}
