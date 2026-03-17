package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserPreferencesRepository @Inject constructor(
    private val preferenceDao: UserPreferenceDao
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
        preferenceDao.insertOrUpdate(current.copy(isLiked = newIsLiked, isDisliked = newIsDisliked))
    }

    suspend fun toggleDislike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        val newIsDisliked = !current.isDisliked
        val newIsLiked = if (newIsDisliked) false else current.isLiked
        preferenceDao.insertOrUpdate(current.copy(isLiked = newIsLiked, isDisliked = newIsDisliked))
    }

    suspend fun removeDislike(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: return
        if (current.isDisliked) {
            preferenceDao.insertOrUpdate(current.copy(isDisliked = false))
        }
    }
    
    suspend fun setLiked(themeId: Long) {
        val current = preferenceDao.getPreference(themeId) ?: UserPreferenceEntity(themeId)
        if (!current.isLiked) {
             preferenceDao.insertOrUpdate(current.copy(isLiked = true, isDisliked = false))
        }
    }
}
