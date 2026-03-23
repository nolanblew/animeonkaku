package com.takeya.animeongaku.sync

import android.util.Log
import com.takeya.animeongaku.data.auth.KitsuTokenStore
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.repository.AnimeRepository
import com.takeya.animeongaku.data.repository.UserRepository
import com.takeya.animeongaku.download.DownloadPreferences
import com.takeya.animeongaku.network.ConnectivityMonitor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException

@Singleton
class LibraryStatusSyncManager @Inject constructor(
    private val userRepository: UserRepository,
    private val animeDao: AnimeDao,
    private val tokenStore: KitsuTokenStore,
    private val autoPlaylistManager: AutoPlaylistManager,
    private val syncManager: SyncManager,
    private val connectivityMonitor: ConnectivityMonitor,
    private val downloadPreferences: DownloadPreferences
) {
    companion object {
        private const val TAG = "LibraryStatusSync"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var syncJob: Job? = null

    val isRunning: Boolean get() = syncJob?.isActive == true

    fun syncIfNeeded(minIntervalMs: Long, onStart: () -> Unit = {}, onComplete: (Int) -> Unit = {}) {
        val lastSyncAt = tokenStore.getLastStatusSyncAt()
        val now = System.currentTimeMillis()
        
        if (now - lastSyncAt >= minIntervalMs) {
            startSync(onStart, onComplete)
        } else {
            onComplete(0)
        }
    }

    fun shouldSync(minIntervalMs: Long): Boolean {
        val lastSyncAt = tokenStore.getLastStatusSyncAt()
        return System.currentTimeMillis() - lastSyncAt >= minIntervalMs
    }

    fun startSync(onStart: () -> Unit = {}, onComplete: (Int) -> Unit = {}) {
        if (isRunning) {
            onComplete(0)
            return
        }

        if (!connectivityMonitor.isOnline.value) {
            Log.d(TAG, "Skipping sync: Device is offline")
            onComplete(0)
            return
        }

        if (downloadPreferences.wifiOnly && !connectivityMonitor.isOnWifi.value) {
            Log.d(TAG, "Skipping sync: Device is not on WiFi and WiFi-only is enabled")
            onComplete(0)
            return
        }

        val userId = tokenStore.getUserId() ?: run {
            onComplete(0)
            return
        }
        
        syncJob = scope.launch {
            try {
                onStart()
                Log.d(TAG, "Starting background status sync")
                
                // 1. Fetch library entries (we need the ones with status)
                // getLibraryEntries internally fetches "current,completed" by default.
                // We want to fetch all relevant statuses.
                val entries = userRepository.getLibraryEntries(userId)
                
                if (entries.isEmpty()) {
                    Log.d(TAG, "No entries found during status sync")
                    tokenStore.saveLastStatusSyncAt(System.currentTimeMillis())
                    onComplete(0)
                    return@launch
                }
                
                val newAnimeIds = mutableListOf<String>()
                
                // 2. Update statuses in local DB
                val knownKitsuIds = animeDao.getAllKitsuIds().toSet()
                
                entries.forEach { entry ->
                    if (knownKitsuIds.contains(entry.id)) {
                        // Update existing
                        val existing = animeDao.getByKitsuId(entry.id)
                        if (existing != null && existing.watchingStatus != entry.watchingStatus) {
                            animeDao.upsertAll(listOf(existing.copy(watchingStatus = entry.watchingStatus)))
                        }
                    } else {
                        // Mark as new
                        newAnimeIds.add(entry.id)
                    }
                }
                
                // 3. Rebuild auto playlists
                autoPlaylistManager.refreshAutoPlaylists()
                tokenStore.saveLastStatusSyncAt(System.currentTimeMillis())
                
                // 4. Trigger full sync for newly discovered anime (in background)
                if (newAnimeIds.isNotEmpty()) {
                    Log.d(TAG, "Discovered ${newAnimeIds.size} new anime during status sync, triggering full sync")
                    // We can just trigger the normal syncManager for this
                    syncManager.startSync(userId, forceFullSync = false)
                }
                
                Log.d(TAG, "Status sync complete. Updated statuses, ${newAnimeIds.size} new anime.")
                onComplete(newAnimeIds.size)
            } catch (e: CancellationException) {
                Log.d(TAG, "Status sync cancelled")
                onComplete(0)
            } catch (e: Exception) {
                Log.e(TAG, "Status sync failed", e)
                onComplete(0)
            }
        }
    }
}
