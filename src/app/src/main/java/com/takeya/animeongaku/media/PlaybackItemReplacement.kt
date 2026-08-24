package com.takeya.animeongaku.media

import java.util.concurrent.atomic.AtomicLong

internal interface PlaybackItemController {
    val items: MutableList<PlaybackMediaDescriptor>
    var currentIndex: Int
    var playWhenReady: Boolean
    fun replaceMediaItem(index: Int, item: PlaybackMediaDescriptor)
    fun seekTo(index: Int, positionMs: Long)
    fun prepare()
}

internal data class PlaybackMediaFingerprint(
    val mediaId: String,
    val uri: String?,
    val tag: PlaybackMediaTag?
)

internal data class VideoFallbackSnapshot(
    val queueVersion: Long,
    val intent: PlaybackIntent,
    val currentMedia: PlaybackMediaFingerprint
)

internal suspend fun <T> resolveForCurrentPlaybackSnapshot(
    captured: VideoFallbackSnapshot,
    currentSnapshot: () -> VideoFallbackSnapshot?,
    resolve: suspend () -> T
): T? {
    val result = resolve()
    return result.takeIf { currentSnapshot() == captured }
}

/** Keeps the old descriptors for retained IDs after Media3 applies its structural queue diff. */
internal fun descriptorsAfterStructuralDiff(
    previousItems: List<PlaybackMediaDescriptor>,
    desiredItems: List<PlaybackMediaDescriptor>
): List<PlaybackMediaDescriptor> {
    val previousById = previousItems.associateBy(PlaybackMediaDescriptor::mediaId)
    return desiredItems.map { desired -> previousById[desired.mediaId] ?: desired }
}

/** Only the newest async resolution generation may mutate Media3 or synchronized bookkeeping. */
internal class LatestPlaybackQueueSync {
    private val generation = AtomicLong(0L)

    fun invalidate() {
        generation.incrementAndGet()
    }

    suspend fun <T> runLatest(
        resolve: suspend () -> T,
        commit: (T) -> Unit
    ): Boolean {
        val ownedGeneration = generation.incrementAndGet()
        val result = resolve()
        if (generation.get() != ownedGeneration) return false
        commit(result)
        return true
    }
}

/** Tracks only in-flight attempts; completion always permits a later explicit Video retry. */
internal class VideoFallbackAttemptRegistry {
    private val inFlightQueueIds = mutableSetOf<Long>()

    @Synchronized
    fun tryStart(queueId: Long): Boolean = inFlightQueueIds.add(queueId)

    @Synchronized
    fun finish(queueId: Long) {
        inFlightQueueIds.remove(queueId)
    }
}

/** Replaces same-occurrence sources/metadata while retaining queue order and play intent. */
internal fun replaceModeChangedPlaybackItems(
    controller: PlaybackItemController,
    desiredItems: List<PlaybackMediaDescriptor>
) {
    if (controller.items.map { it.mediaId } != desiredItems.map { it.mediaId }) return
    val currentIndex = controller.currentIndex
    val oldCurrent = controller.items.getOrNull(currentIndex)
    val wasPlayWhenReady = controller.playWhenReady
    val changed = desiredItems.indices.filter { index ->
        controller.items[index].playbackFingerprint() != desiredItems[index].playbackFingerprint()
    }
    // A completed analysis can arrive while this item is playing. Keep its gain fixed until the
    // next item boundary; replacing only an updated gain would cause a mid-song level step.
    val replaceNow = changed.filter { index ->
        index != currentIndex ||
            controller.items[index].contentFingerprint() != desiredItems[index].contentFingerprint()
    }
    replaceNow.forEach { index -> controller.replaceMediaItem(index, desiredItems[index]) }

    if (currentIndex in replaceNow) {
        val previousMode = oldCurrent?.tag?.actualMode
        val desiredMode = desiredItems[currentIndex].tag.actualMode
        if (
            previousMode == PlaybackMode.VIDEO ||
            desiredMode == PlaybackMode.FULL_SIZE ||
            desiredMode == PlaybackMode.VIDEO
        ) {
            controller.seekTo(currentIndex, 0L)
        }
        controller.playWhenReady = wasPlayWhenReady
        controller.prepare()
    }
}

private fun PlaybackMediaDescriptor.playbackFingerprint(): List<String?> = listOf(
    *contentFingerprint().toTypedArray(),
    tag.loudness?.attenuationGainDb()?.toString()
)

private fun PlaybackMediaDescriptor.contentFingerprint(): List<String?> = listOf(
    uri,
    tag.playableKey.toString(),
    tag.preferredMode.name,
    tag.actualMode?.name,
    title,
    artist,
    albumTitle
)
