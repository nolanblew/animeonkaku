package com.takeya.animeongaku.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface UserPreferenceDao {
    @Query("SELECT * FROM user_preferences WHERE themeId = :themeId LIMIT 1")
    fun observePreference(themeId: Long): Flow<UserPreferenceEntity?>

    @Query("SELECT * FROM user_preferences WHERE themeId = :themeId LIMIT 1")
    suspend fun getPreference(themeId: Long): UserPreferenceEntity?

    @Query("SELECT * FROM user_preferences")
    fun observeAllPreferences(): Flow<List<UserPreferenceEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(preference: UserPreferenceEntity)
    
    @Query("SELECT themeId FROM user_preferences WHERE isLiked = 1")
    fun observeLikedThemeIds(): Flow<List<Long>>

    @Query("SELECT themeId FROM user_preferences WHERE isDisliked = 1")
    fun observeDislikedThemeIds(): Flow<List<Long>>
    
    @Query("SELECT themeId FROM user_preferences WHERE isDisliked = 1")
    suspend fun getDislikedThemeIds(): List<Long>
    
    @Query("SELECT themeId FROM user_preferences WHERE isLiked = 1")
    suspend fun getLikedThemeIds(): List<Long>
}
