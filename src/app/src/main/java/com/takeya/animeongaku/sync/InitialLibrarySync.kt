package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.delay

interface LibraryPuller {
    suspend fun pullNow(forceFull: Boolean = false): LibraryPullResult
}

interface InitialLibrarySync {
    suspend fun runFullSync(onStatus: (String) -> Unit = {})
}

class InitialLibrarySyncException(message: String) : Exception(message)

@Singleton
class ServerInitialLibrarySync @Inject constructor(
    private val api: OngakuApi,
    private val libraryPuller: LibraryPuller
) : InitialLibrarySync {

    override suspend fun runFullSync(onStatus: (String) -> Unit) {
        onStatus("Starting your first library sync...")
        api.startSync(OngakuSyncRequest(full = true))
        onStatus("Server sync queued")

        while (true) {
            val status = api.syncStatus()
            val syncState = status.toSyncState()
            onStatus(syncState.status)

            if (syncState.phase == SyncPhase.Error) {
                throw InitialLibrarySyncException(syncState.errorMessage ?: "Server sync failed.")
            }

            when (status.state.uppercase()) {
                "QUEUED", "RUNNING" -> delay(SERVER_SYNC_POLL_INTERVAL_MS)
                "FAILED", "CANCELLED" -> throw InitialLibrarySyncException(
                    syncState.errorMessage ?: "Server sync failed."
                )
                else -> {
                    onStatus("Loading your library on this device...")
                    libraryPuller.pullNow(forceFull = true)
                    onStatus("Library ready")
                    return
                }
            }
        }
    }

    companion object {
        private const val SERVER_SYNC_POLL_INTERVAL_MS = 2_000L
    }
}
