package com.takeya.animeongaku.sync

import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecEntity
import com.takeya.animeongaku.data.local.PlayCountDao
import com.takeya.animeongaku.data.local.PlayCountEntity
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuPlayEvent
import com.takeya.animeongaku.data.remote.OngakuPlaylistRequest
import com.takeya.animeongaku.data.remote.OngakuThemePrefPatch
import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton

data class ServerMigrationResult(
    val migrated: Boolean,
    val skipReason: ServerMigrationSkipReason? = null,
    val uploadedPrefs: Int = 0,
    val uploadedPlayEvents: Int = 0,
    val uploadedPlaylists: Int = 0,
    val uploadedSpecs: Int = 0
)

enum class ServerMigrationSkipReason {
    NotReady,
    AlreadyComplete
}

interface ServerMigrationStore {
    suspend fun preferences(): List<UserPreferenceEntity>
    suspend fun playCounts(): List<PlayCountEntity>
    suspend fun manualPlaylists(): List<PlaylistEntity>
    suspend fun themeIdsInPlaylist(playlistId: Long): List<Long>
    suspend fun dynamicSpecs(): List<DynamicPlaylistSpecEntity>
}

@Singleton
class RoomServerMigrationStore @Inject constructor(
    private val userPreferenceDao: UserPreferenceDao,
    private val playCountDao: PlayCountDao,
    private val playlistDao: PlaylistDao,
    private val dynamicPlaylistSpecDao: DynamicPlaylistSpecDao
) : ServerMigrationStore {
    override suspend fun preferences(): List<UserPreferenceEntity> =
        userPreferenceDao.getAllPreferences()

    override suspend fun playCounts(): List<PlayCountEntity> =
        playCountDao.getAllPlayCounts()

    override suspend fun manualPlaylists(): List<PlaylistEntity> =
        playlistDao.getManualPlaylists()

    override suspend fun themeIdsInPlaylist(playlistId: Long): List<Long> =
        playlistDao.getThemeIdsInPlaylist(playlistId)

    override suspend fun dynamicSpecs(): List<DynamicPlaylistSpecEntity> =
        dynamicPlaylistSpecDao.getAll()
}

@Singleton
class ServerMigrationManager @Inject constructor(
    private val settingsStore: ServerSettingsStore,
    private val tokenStore: ServerTokenStore,
    private val store: ServerMigrationStore,
    private val ongakuApi: OngakuApi,
    private val moshi: Moshi
) {
    private val mapAdapter by lazy {
        val type = Types.newParameterizedType(
            Map::class.java,
            String::class.java,
            Any::class.java
        )
        moshi.adapter<Map<String, Any?>>(type)
    }

    suspend fun migrateIfNeeded(): ServerMigrationResult {
        if (!settingsStore.isConfigured || tokenStore.currentSession() == null) {
            return ServerMigrationResult(
                migrated = false,
                skipReason = ServerMigrationSkipReason.NotReady
            )
        }
        if (settingsStore.isServerMigrationComplete) {
            return ServerMigrationResult(
                migrated = false,
                skipReason = ServerMigrationSkipReason.AlreadyComplete
            )
        }

        val uploadedPrefs = uploadPreferences()
        val uploadedPlayEvents = uploadPlayCounts()
        val playlistIdMap = uploadManualPlaylists()
        val uploadedSpecs = uploadDynamicSpecs(playlistIdMap)

        settingsStore.markServerMigrationComplete()
        return ServerMigrationResult(
            migrated = true,
            uploadedPrefs = uploadedPrefs,
            uploadedPlayEvents = uploadedPlayEvents,
            uploadedPlaylists = playlistIdMap.size,
            uploadedSpecs = uploadedSpecs
        )
    }

    private suspend fun uploadPreferences(): Int {
        val preferences = store.preferences()
        preferences.forEach { preference ->
            ongakuApi.updateThemePref(
                preference.themeId,
                OngakuThemePrefPatch(
                    liked = preference.isLiked,
                    disliked = preference.isDisliked
                )
            )
        }
        return preferences.size
    }

    private suspend fun uploadPlayCounts(): Int {
        var uploaded = 0
        store.playCounts()
            .flatMap { playCount ->
                val eventCount = playCount.playCount.coerceAtLeast(0)
                List(eventCount) {
                    OngakuPlayEvent(
                        themeId = playCount.themeId,
                        playedAt = playCount.lastPlayedAt
                    )
                }
            }
            .chunked(PLAY_EVENT_BATCH_SIZE)
            .forEach { batch ->
                if (batch.isNotEmpty()) {
                    ongakuApi.recordPlays(batch)
                    uploaded += batch.size
                }
            }
        return uploaded
    }

    private suspend fun uploadManualPlaylists(): Map<Long, Long> {
        val serverIdsByLocalId = mutableMapOf<Long, Long>()
        store.manualPlaylists().forEach { playlist ->
            val response = ongakuApi.createPlaylist(
                OngakuPlaylistRequest(
                    name = playlist.name,
                    entries = store.themeIdsInPlaylist(playlist.id)
                )
            )
            serverIdsByLocalId[playlist.id] = response.playlist.id
        }
        return serverIdsByLocalId
    }

    private suspend fun uploadDynamicSpecs(playlistIdMap: Map<Long, Long>): Int {
        var uploaded = 0
        store.dynamicSpecs().forEach { spec ->
            val serverPlaylistId = playlistIdMap[spec.playlistId] ?: spec.playlistId
            ongakuApi.updatePlaylistSpec(serverPlaylistId, spec.toServerPayload())
            uploaded += 1
        }
        return uploaded
    }

    private fun DynamicPlaylistSpecEntity.toServerPayload(): Map<String, Any?> =
        mapOf(
            "filterJson" to parseJsonField(filterJson),
            "mode" to mode,
            "createdMode" to createdMode,
            "sortJson" to sortJson?.let(::parseJsonField),
            "simpleStateJson" to simpleStateJson?.let(::parseJsonField),
            "schemaVersion" to schemaVersion
        )

    private fun parseJsonField(value: String): Any? {
        return runCatching {
            mapAdapter.fromJson(value)
        }.getOrNull() ?: value
    }

    companion object {
        private const val PLAY_EVENT_BATCH_SIZE = 100
    }
}
