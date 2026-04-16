package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.local.DynamicPlaylistSpecDao
import com.takeya.animeongaku.data.repository.DynamicPlaylistRepository
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DynamicPlaylistManager @Inject constructor(
    private val specDao: DynamicPlaylistSpecDao,
    private val repository: DynamicPlaylistRepository
) {
    companion object {
        private const val TAG = "DynamicPlaylistManager"
    }

    /** Re-evaluate all AUTO-mode dynamic playlists. Snapshot playlists are skipped. */
    suspend fun refreshAllAutoSuspend() {
        val autoSpecs = specDao.getAllAuto()
        for (spec in autoSpecs) {
            try {
                repository.refreshOne(spec.playlistId)
                Log.d(TAG, "Refreshed dynamic playlist ${spec.playlistId}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to refresh dynamic playlist ${spec.playlistId}", e)
            }
        }
    }

    /** Manually refresh a single playlist (works for both AUTO and SNAPSHOT). */
    suspend fun refreshOne(playlistId: Long) {
        repository.refreshOne(playlistId)
    }
}
