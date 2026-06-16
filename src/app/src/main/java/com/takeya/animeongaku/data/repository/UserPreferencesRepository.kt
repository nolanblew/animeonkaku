package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.sync.SyncEngine
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferencesRepository @Inject constructor(
    private val preferenceDao: UserPreferenceDao,
    private val syncEngine: SyncEngine
) {
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
    
    suspend fun getDislikedThemeIds(): Set<Long> {
        return preferenceDao.getDislikedThemeIds().toSet()
    }

    suspend fun toggleLike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        val newIsLiked = !current.isLiked
        val newIsDisliked = if (newIsLiked) false else current.isDisliked
        val opTs = System.currentTimeMillis()
        val updated = current.copy(
            isLiked = newIsLiked,
            isDisliked = newIsDisliked,
            updatedAt = opTs,
            deletedAt = null
        )
        preferenceDao.insertOrUpdate(updated)
        syncEngine.enqueueThemePreference(updated.themeId, updated.isLiked, updated.isDisliked, opTs)
        syncEngine.pushPendingWrites()
    }

    suspend fun toggleDislike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        val newIsDisliked = !current.isDisliked
        val newIsLiked = if (newIsDisliked) false else current.isLiked
        val opTs = System.currentTimeMillis()
        val updated = current.copy(
            isLiked = newIsLiked,
            isDisliked = newIsDisliked,
            updatedAt = opTs,
            deletedAt = null
        )
        preferenceDao.insertOrUpdate(updated)
        syncEngine.enqueueThemePreference(updated.themeId, updated.isLiked, updated.isDisliked, opTs)
        syncEngine.pushPendingWrites()
    }

    suspend fun removeDislike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: return
        if (current.isDisliked) {
            val opTs = System.currentTimeMillis()
            val updated = current.copy(isDisliked = false, updatedAt = opTs, deletedAt = null)
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated.themeId, updated.isLiked, updated.isDisliked, opTs)
            syncEngine.pushPendingWrites()
        }
    }
    
    suspend fun setLiked(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        if (!current.isLiked) {
            val opTs = System.currentTimeMillis()
            val updated = current.copy(
                isLiked = true,
                isDisliked = false,
                updatedAt = opTs,
                deletedAt = null
            )
            preferenceDao.insertOrUpdate(updated)
            syncEngine.enqueueThemePreference(updated.themeId, updated.isLiked, updated.isDisliked, opTs)
            syncEngine.pushPendingWrites()
        }
    }
}
