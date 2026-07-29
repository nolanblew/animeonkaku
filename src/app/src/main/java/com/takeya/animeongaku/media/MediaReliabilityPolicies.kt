package com.takeya.animeongaku.media

import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.CancellationException
import kotlin.math.min

/**
 * Small, side-effect-free policies used by the playback stack. Keeping them separate makes
 * lifecycle-sensitive behaviour testable without a running Media3 service.
 */
internal fun controllerConnectionRetryDelayMs(failure: Throwable, attempt: Int): Long {
    // A cancelled future and an exception from a dead service are both recoverable while the app
    // is alive. Bound the delay so a transient failure neither hot-loops nor leaves playback
    // unavailable for an unreasonable period of time.
    @Suppress("UNUSED_VARIABLE")
    val recoverableError = failure is CancellationException || failure is Exception
    val normalizedAttempt = attempt.coerceAtLeast(0)
    return min(5_000L, 250L shl min(normalizedAttempt, 4))
}

internal fun playWhenReadyAfterQueueReplacement(
    wasPlaying: Boolean,
    userRequestedPlay: Boolean,
): Boolean = wasPlaying || userRequestedPlay

internal fun hasUnconsumedPlayRequest(currentGeneration: Long, consumedGeneration: Long): Boolean =
    currentGeneration > consumedGeneration

internal fun playRequestGenerationAfterPause(currentGeneration: Long): Long = currentGeneration

internal fun playbackPositionPollIntervalMs(isPlaying: Boolean): Long? =
    if (isPlaying) 500L else null

internal fun shouldSchedulePlaybackTeardownPersist(hasUnsavedState: Boolean): Boolean =
    hasUnsavedState

internal fun shouldPreCacheOnNetwork(
    wifiOnly: Boolean,
    isUnmetered: Boolean,
): Boolean = !wifiOnly || isUnmetered

internal data class PlaybackResolutionBatchRequest(
    val themeIds: Set<Long>,
    val mediaKeys: Set<MediaKey>,
)

internal fun buildPlaybackResolutionBatchRequest(
    entries: Collection<QueueEntry>,
): PlaybackResolutionBatchRequest = PlaybackResolutionBatchRequest(
    themeIds = entries.mapNotNullTo(linkedSetOf()) { it.themeOrNull?.id },
    mediaKeys = entries.flatMapTo(linkedSetOf()) { it.possibleMediaKeys() },
)

/**
 * Writes a complete replacement to a sibling temporary file before replacing [target]. A failed
 * serializer therefore cannot destroy the last known-good playback snapshot.
 */
internal fun writeTextAtomically(
    target: File,
    writeTemporary: (File) -> Unit,
) {
    val parent = target.parentFile ?: error("Playback persistence target must have a parent")
    if (!parent.exists() && !parent.mkdirs()) {
        error("Unable to create playback persistence directory: $parent")
    }

    val temporary = File.createTempFile(".${target.name}.", ".tmp", parent)
    try {
        writeTemporary(temporary)
        FileOutputStream(temporary, true).use { output ->
            output.fd.sync()
        }
        try {
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(
                temporary.toPath(),
                target.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }
    } finally {
        if (temporary.exists()) {
            temporary.delete()
        }
    }
}
