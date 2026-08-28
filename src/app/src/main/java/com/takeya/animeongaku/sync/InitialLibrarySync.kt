package com.takeya.animeongaku.sync

import com.takeya.animeongaku.data.auth.ServerSyncMode
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

interface LibraryPuller {
    suspend fun pullNow(forceFull: Boolean = false): LibraryPullResult
}

interface InitialLibrarySync {
    suspend fun runInitialSync(
        mode: ServerSyncMode = ServerSyncMode.FULL,
        onProgress: (FirstSyncProgress) -> Unit = {}
    )

    /** Keeps a returning user's cached library usable while refresh work continues. */
    fun startBackgroundSync(mode: ServerSyncMode) = Unit
}

class InitialLibrarySyncException(message: String) : Exception(message)

@Singleton
class LibrarySyncIndicator @Inject constructor() {
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    internal fun update(message: String?) {
        _message.value = message
    }
}

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
    private val libraryPuller: LibraryPuller,
    private val indicator: LibrarySyncIndicator = LibrarySyncIndicator()
) : InitialLibrarySync {
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    internal var pollIntervalMs: Long = SERVER_SYNC_POLL_INTERVAL_MS
    internal var stallTimeoutMs: Long = SERVER_SYNC_STALL_TIMEOUT_MS
    internal var clock: () -> Long = System::currentTimeMillis

    override suspend fun runInitialSync(
        mode: ServerSyncMode,
        onProgress: (FirstSyncProgress) -> Unit
    ) {
        if (mode == ServerSyncMode.NONE) {
            onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Loading your library on this device..."))
            libraryPuller.pullNow(forceFull = true)
            onProgress(FirstSyncProgress(FirstSyncStep.LoadDevice, "Library ready"))
            return
        }
        val startMessage = when (mode) {
            ServerSyncMode.FULL -> "Starting your first library sync..."
            ServerSyncMode.DELTA -> "Checking for library updates..."
            ServerSyncMode.NONE -> error("Handled above")
        }
        onProgress(FirstSyncProgress(FirstSyncStep.SyncLibrary, startMessage))
        api.startSync(OngakuSyncRequest(full = mode == ServerSyncMode.FULL))
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

    override fun startBackgroundSync(mode: ServerSyncMode) {
        backgroundScope.launch {
            indicator.update("Syncing your library…")
            try {
                runInitialSync(mode) { progress -> indicator.update(progress.message) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Cached data remains usable; foreground refreshes will retry later.
            } finally {
                indicator.update(null)
            }
        }
    }

    companion object {
        private const val SERVER_SYNC_POLL_INTERVAL_MS = 2_000L
        private const val SERVER_SYNC_STALL_TIMEOUT_MS = 10 * 60_000L
        private const val MAX_CONSECUTIVE_POLL_FAILURES = 5
    }
}
