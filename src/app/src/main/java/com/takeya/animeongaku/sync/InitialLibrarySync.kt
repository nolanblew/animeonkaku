package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

interface LibraryPuller {
    suspend fun pullNow(forceFull: Boolean = false): LibraryPullResult
}

interface InitialLibrarySync {
    suspend fun runFullSync(onProgress: (FirstSyncProgress) -> Unit = {})
}

class InitialLibrarySyncException(message: String) : Exception(message)

/**
 * Drives the first sign-in sync. The server sync it waits on is metadata-only
 * (library entries + theme mappings); audio caching happens later on the
 * server's background download queue, so completion never blocks on binaries.
 *
 * Stuck protection: transient status-poll failures are retried a few times,
 * and if the server reports no observable progress for [stallTimeoutMs] the
 * sync fails with a clear error instead of leaving the user on this screen.
 */
@Singleton
class ServerInitialLibrarySync @Inject constructor(
    private val api: OngakuApi,
    private val libraryPuller: LibraryPuller
) : InitialLibrarySync {

    internal var pollIntervalMs: Long = SERVER_SYNC_POLL_INTERVAL_MS
    internal var stallTimeoutMs: Long = SERVER_SYNC_STALL_TIMEOUT_MS
    internal var clock: () -> Long = System::currentTimeMillis

    override suspend fun runFullSync(onProgress: (FirstSyncProgress) -> Unit) {
        onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Starting your first library sync..."))
        api.startSync(OngakuSyncRequest(full = true))
        onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, "Server sync queued"))

        var consecutivePollFailures = 0
        var lastFingerprint: String? = null
        var lastChangeAtMs = clock()

        while (true) {
            val status = try {
                api.syncStatus().also { consecutivePollFailures = 0 }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                consecutivePollFailures++
                if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
                    throw InitialLibrarySyncException(
                        "Lost connection to the server while syncing. Please try again."
                    )
                }
                delay(pollIntervalMs)
                continue
            }

            val syncState = status.toSyncState()
            if (syncState.phase == SyncPhase.Error) {
                throw InitialLibrarySyncException(syncState.errorMessage ?: "Server sync failed.")
            }

            val fingerprint = "${status.state}|${status.phase}|${status.progress}"
            val nowMs = clock()
            if (fingerprint != lastFingerprint) {
                lastFingerprint = fingerprint
                lastChangeAtMs = nowMs
            } else if (nowMs - lastChangeAtMs >= stallTimeoutMs) {
                throw InitialLibrarySyncException(
                    "The server sync stopped making progress. Please try again in a few minutes."
                )
            }

            when (status.state.uppercase()) {
                "QUEUED", "RUNNING" -> {
                    onProgress(FirstSyncProgress(syncState.phase.toFirstSyncStep(), syncState.status))
                    delay(pollIntervalMs)
                }
                "FAILED", "CANCELLED" -> throw InitialLibrarySyncException(
                    syncState.errorMessage ?: "Server sync failed."
                )
                else -> {
                    onProgress(
                        FirstSyncProgress(FirstSyncStep.LoadDevice, "Loading your library on this device...")
                    )
                    libraryPuller.pullNow(forceFull = true)
                    onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Library ready"))
                    return
                }
            }
        }
    }

    companion object {
        private const val SERVER_SYNC_POLL_INTERVAL_MS = 2_000L
        private const val SERVER_SYNC_STALL_TIMEOUT_MS = 10 * 60_000L
        private const val MAX_CONSECUTIVE_POLL_FAILURES = 5
    }
}
