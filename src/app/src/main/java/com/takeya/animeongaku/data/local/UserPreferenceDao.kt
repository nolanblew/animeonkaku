package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface UserPreferenceDao {
    @Query("SELECT * FROM user_preferences WHERE themeId = :themeId AND deletedAt IS NULL LIMIT 1")
    fun observePreference(themeId: Long): Flow<UserPreferenceEntity?>

    @Query("SELECT * FROM user_preferences WHERE themeId = :themeId AND deletedAt IS NULL LIMIT 1")
    suspend fun getPreference(themeId: Long): UserPreferenceEntity?

    @Query("SELECT * FROM user_preferences WHERE deletedAt IS NULL")
    fun observeAllPreferences(): Flow<List<UserPreferenceEntity>>

    @Query("SELECT * FROM user_preferences WHERE deletedAt IS NULL")
    suspend fun getAllPreferences(): List<UserPreferenceEntity>

    @Query("SELECT * FROM user_preferences WHERE themeId IN (:themeIds)")
    suspend fun getPreferencesByIdsIncludingDeleted(themeIds: List<Long>): List<UserPreferenceEntity>

    @Query("DELETE FROM user_preferences WHERE themeId IN (:themeIds)")
    suspend fun deleteByThemeIds(themeIds: List<Long>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(preference: UserPreferenceEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(preferences: List<UserPreferenceEntity>)
    
    @Query("SELECT themeId FROM user_preferences WHERE isLiked = 1 AND deletedAt IS NULL")
    fun observeLikedThemeIds(): Flow<List<Long>>

    @Query("SELECT themeId FROM user_preferences WHERE isDisliked = 1 AND deletedAt IS NULL")
    fun observeDislikedThemeIds(): Flow<List<Long>>
    
    @Query("SELECT themeId FROM user_preferences WHERE isDisliked = 1 AND deletedAt IS NULL")
    suspend fun getDislikedThemeIds(): List<Long>
    
    @Query("SELECT themeId FROM user_preferences WHERE isLiked = 1 AND deletedAt IS NULL")
    suspend fun getLikedThemeIds(): List<Long>
}
