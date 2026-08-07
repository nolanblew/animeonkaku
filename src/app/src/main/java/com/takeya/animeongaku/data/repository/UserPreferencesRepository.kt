package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.local.SongPreferenceDao
import com.takeya.animeongaku.data.local.SongPreferenceEntity
import com.takeya.animeongaku.sync.ServerUserStateRefresher
import com.takeya.animeongaku.sync.SyncEngine
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferencesRepository @Inject constructor(
    private val preferenceDao: UserPreferenceDao,
    private val syncEngine: SyncEngine,
    private val serverUserStateRefresher: ServerUserStateRefresher,
    private val songPreferenceDao: SongPreferenceDao? = null
) {
    private val dislikeMutationMutex = Mutex()

    fun observePreference(themeId: Long): Flow<UserPreferenceEntity?> {
        return preferenceDao.observePreference(themeId)
    }

    fun observeAllPreferences(): Flow<List<UserPreferenceEntity>> {
        return preferenceDao.observeAllPreferences()
    }

    fun observeLikedThemeIds(): Flow<List<Long>> {
        return preferenceDao.observeLikedThemeIds()
    }

    fun observeDislikedThemeIds(): Flow<List<Long>> {
        return preferenceDao.observeDislikedThemeIds()
    }

    fun observeSongPreference(songId: Long): Flow<SongPreferenceEntity?> =
        requireSongPreferenceDao().observe(songId)

    fun observeSongPreferences(): Flow<List<SongPreferenceEntity>> =
        requireSongPreferenceDao().observeAll()

    fun observeDislikedSongIds(): Flow<List<Long>> = requireSongPreferenceDao().observeAll()
        .map { preferences -> preferences.filter { it.isDisliked }.map { it.songId } }
    
    suspend fun getDislikedThemeIds(): Set<Long> {
        return preferenceDao.getDislikedThemeIds().toSet()
    }

    suspend fun toggleLike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        val newIsLiked = !current.isLiked
        val opTs = System.currentTimeMillis()
        val updated = current.withThemeLike(newIsLiked, opTs)
        preferenceDao.insertOrUpdate(updated)
        syncEngine.enqueueThemePreference(updated, opTs)
        pushPendingPreferenceWriteAndRefresh()
    }

    suspend fun toggleDislike(themeId: Long) {
        dislikeMutationMutex.withLock {
            val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
            val newIsDisliked = !current.isDisliked
            val opTs = System.currentTimeMillis()
            val updated = current.withBroadThemeDislike(newIsDisliked, opTs)
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated, opTs)
            pushPendingPreferenceWriteAndRefresh()
        }
    }

    suspend fun removeDislike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: return
        if (current.isDisliked) {
            val opTs = System.currentTimeMillis()
            val updated = current.copy(isDisliked = false, updatedAt = opTs, deletedAt = null)
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated, opTs)
            pushPendingPreferenceWriteAndRefresh()
        }
    }
    
    suspend fun setLiked(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        if (!current.isLiked) {
            val opTs = System.currentTimeMillis()
            val updated = current.copy(
                isLiked = true,
                isDisliked = false,
                isDislikedTvSize = false,
                isDislikedFullSize = false,
                updatedAt = opTs,
                deletedAt = null
            )
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated, opTs)
            pushPendingPreferenceWriteAndRefresh()
        }
    }

    suspend fun setPreferredMode(themeId: Long, mode: String?) {
        require(mode == null || mode == "TV_SIZE" || mode == "FULL_SIZE") {
            "Preferred mode must be TV_SIZE, FULL_SIZE, or null"
        }
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        if (current.preferredMode == mode) return
        val opTs = System.currentTimeMillis()
        val updated = current.copy(preferredMode = mode, updatedAt = opTs, deletedAt = null)
        preferenceDao.insertOrUpdate(updated)
        syncEngine.enqueueThemePreferredMode(themeId, mode, opTs)
        pushPendingPreferenceWriteAndRefresh()
    }

    /** A normal dislike suppresses every mode of this theme; scoped actions clear it first. */
    suspend fun toggleModeDislike(themeId: Long, fullSize: Boolean) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        val next = if (fullSize) !current.isDislikedFullSize else !current.isDislikedTvSize
        val opTs = System.currentTimeMillis()
        val updated = current.withModeThemeDislike(fullSize, next, opTs)
        preferenceDao.insertOrUpdate(updated)
        syncEngine.enqueueThemePreference(updated, opTs)
        pushPendingPreferenceWriteAndRefresh()
    }

    /** Replaces a broad dislike with exactly one scoped dislike. */
    suspend fun setOnlyModeDislike(themeId: Long, fullSize: Boolean) {
        dislikeMutationMutex.withLock {
            val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
            val opTs = System.currentTimeMillis()
            val updated = current.copy(
                isLiked = false,
                isDisliked = false,
                isDislikedTvSize = !fullSize,
                isDislikedFullSize = fullSize,
                updatedAt = opTs,
                deletedAt = null
            )
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated, opTs)
            pushPendingPreferenceWriteAndRefresh()
        }
    }

    suspend fun toggleSongLike(songId: Long) {
        val current = requireSongPreferenceDao().get(songId) ?: SongPreferenceEntity(songId)
        val liked = !current.isLiked
        updateSongPreference(current.copy(
            isLiked = liked,
            isDisliked = if (liked) false else current.isDisliked,
            updatedAt = System.currentTimeMillis(),
            deletedAt = null
        ))
    }

    suspend fun toggleSongDislike(songId: Long) {
        val current = requireSongPreferenceDao().get(songId) ?: SongPreferenceEntity(songId)
        val disliked = !current.isDisliked
        updateSongPreference(current.copy(
            isLiked = if (disliked) false else current.isLiked,
            isDisliked = disliked,
            updatedAt = System.currentTimeMillis(),
            deletedAt = null
        ))
    }

    private suspend fun updateSongPreference(preference: SongPreferenceEntity) {
        requireSongPreferenceDao().upsert(preference)
        syncEngine.enqueueSongPreference(preference, preference.updatedAt)
        pushPendingPreferenceWriteAndRefresh()
    }

    private suspend fun pushPendingPreferenceWriteAndRefresh() {
        runCatching { serverUserStateRefresher.refreshLocalAfterPreferenceWrite() }
        val result = syncEngine.pushPendingWrites()
        if (!result.failed) {
            runCatching { serverUserStateRefresher.refreshAfterPreferenceWrite() }
        }
    }

    private fun requireSongPreferenceDao(): SongPreferenceDao =
        requireNotNull(songPreferenceDao) { "Song preferences require the MC-A01 catalog database" }
}

internal fun UserPreferenceEntity.withThemeLike(liked: Boolean, timestamp: Long): UserPreferenceEntity =
    copy(
        isLiked = liked,
        isDisliked = if (liked) false else isDisliked,
        isDislikedTvSize = if (liked) false else isDislikedTvSize,
        isDislikedFullSize = if (liked) false else isDislikedFullSize,
        updatedAt = timestamp,
        deletedAt = null
    )

internal fun UserPreferenceEntity.withBroadThemeDislike(disliked: Boolean, timestamp: Long): UserPreferenceEntity =
    copy(
        isLiked = if (disliked) false else isLiked,
        isDisliked = disliked,
        isDislikedTvSize = if (disliked) false else isDislikedTvSize,
        isDislikedFullSize = if (disliked) false else isDislikedFullSize,
        updatedAt = timestamp,
        deletedAt = null
    )

internal fun UserPreferenceEntity.withModeThemeDislike(
    fullSize: Boolean,
    disliked: Boolean,
    timestamp: Long
): UserPreferenceEntity = if (fullSize) copy(
    isLiked = false,
    isDisliked = false,
    isDislikedTvSize = isDislikedTvSize,
    isDislikedFullSize = disliked,
    updatedAt = timestamp,
    deletedAt = null
) else copy(
    isLiked = false,
    isDisliked = false,
    isDislikedTvSize = disliked,
    isDislikedFullSize = isDislikedFullSize,
    updatedAt = timestamp,
    deletedAt = null
)
