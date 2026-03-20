package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.auth.KitsuTokenStore
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.PlaylistDao
import com.takeya.animeongaku.data.local.PlaylistEntity
import com.takeya.animeongaku.data.local.PlaylistEntryEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.UserPreferenceDao
import com.takeya.animeongaku.data.repository.UserRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.random.Random

@Singleton
class AutoPlaylistManager @Inject constructor(
    private val userRepository: UserRepository,
    private val animeDao: AnimeDao,
    private val themeDao: ThemeDao,
    private val playlistDao: PlaylistDao,
    private val tokenStore: KitsuTokenStore,
    private val userPreferenceDao: UserPreferenceDao
) {
    companion object {
        private const val TAG = "AutoPlaylistManager"
        const val CURRENTLY_WATCHING_NAME = "Currently Watching"
        const val LIKED_SONGS_NAME = "Liked Songs"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun refreshAutoPlaylists() {
        val userId = tokenStore.getUserId() ?: return
        scope.launch {
            try {
                refreshCurrentlyWatching()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to refresh Currently Watching", e)
            }
            try {
                refreshLikedSongs()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to refresh Liked Songs", e)
            }
        }
    }

    private suspend fun refreshCurrentlyWatching() {
        Log.d(TAG, "Refreshing '$CURRENTLY_WATCHING_NAME' auto-playlist…")

        val watchingEntries = animeDao.getByWatchingStatus("current")
        if (watchingEntries.isEmpty()) {
            Log.d(TAG, "No currently watching entries found in local DB")
            val existing = playlistDao.findAutoPlaylistByName(CURRENTLY_WATCHING_NAME)
            if (existing != null) {
                playlistDao.deletePlaylistEntries(existing.id)
            }
            return
        }

        val watchingAnimeThemesIds = mutableSetOf<Long>()
        for (entry in watchingEntries) {
            if (entry.animeThemesId != null) {
                watchingAnimeThemesIds.add(entry.animeThemesId)
            }
        }

        val allThemes = themeDao.getAllThemes()
        val watchingThemes = allThemes.filter { it.animeId in watchingAnimeThemesIds }

        if (watchingThemes.isEmpty()) {
            Log.d(TAG, "Currently watching anime have no mapped themes")
            return
        }

        val existing = playlistDao.findAutoPlaylistByName(CURRENTLY_WATCHING_NAME)
        val playlistId = if (existing != null) {
            playlistDao.deletePlaylistEntries(existing.id)
            existing.id
        } else {
            playlistDao.insertPlaylist(
                PlaylistEntity(
                    name = CURRENTLY_WATCHING_NAME,
                    createdAt = System.currentTimeMillis(),
                    isAuto = true,
                    gradientSeed = Random.nextInt()
                )
            )
        }

        val entries = watchingThemes.mapIndexed { index, theme ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = theme.id,
                orderIndex = index
            )
        }
        playlistDao.insertEntries(entries)
        Log.d(TAG, "Updated '$CURRENTLY_WATCHING_NAME' with ${entries.size} tracks from ${watchingAnimeThemesIds.size} anime")
    }

    suspend fun refreshLikedSongs() {
        Log.d(TAG, "Refreshing '$LIKED_SONGS_NAME' auto-playlist…")

        val likedIds = userPreferenceDao.getLikedThemeIds()
        if (likedIds.isEmpty()) {
            Log.d(TAG, "No liked songs found")
            // Optionally, delete if it exists and becomes empty
            val existing = playlistDao.findAutoPlaylistByName(LIKED_SONGS_NAME)
            if (existing != null) {
                playlistDao.deletePlaylist(existing.id)
            }
            return
        }

        // We use getByIds on ThemeDao to get actual themes that aren't deleted
        val themes = themeDao.getByIds(likedIds)

        // Find or create the auto-playlist
        val existing = playlistDao.findAutoPlaylistByName(LIKED_SONGS_NAME)
        val playlistId = if (existing != null) {
            playlistDao.deletePlaylistEntries(existing.id)
            existing.id
        } else {
            playlistDao.insertPlaylist(
                PlaylistEntity(
                    name = LIKED_SONGS_NAME,
                    createdAt = System.currentTimeMillis(),
                    isAuto = true,
                    gradientSeed = Random.nextInt()
                )
            )
        }

        // Insert all liked themes
        val entries = themes.mapIndexed { index, theme ->
            PlaylistEntryEntity(
                playlistId = playlistId,
                themeId = theme.id,
                orderIndex = index
            )
        }
        playlistDao.insertEntries(entries)
        Log.d(TAG, "Updated '$LIKED_SONGS_NAME' with ${entries.size} tracks")
    }
}
