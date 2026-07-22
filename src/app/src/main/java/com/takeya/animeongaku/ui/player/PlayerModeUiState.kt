package com.takeya.animeongaku.ui.player

import android.content.res.Configuration
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.PlaybackState

data class VideoContentWarning(
    val spoiler: Boolean,
    val nsfw: Boolean
) {
    val message: String
        get() = when {
            spoiler && nsfw -> "This video is marked as a spoiler and NSFW."
            spoiler -> "This video is marked as a spoiler."
            else -> "This video is marked as NSFW."
        }
}

sealed interface ModeSelectionDecision {
    data object Ignore : ModeSelectionDecision
    data class Apply(val mode: PlaybackMode) : ModeSelectionDecision
    data class Confirm(
        val mode: PlaybackMode,
        val warning: VideoContentWarning
    ) : ModeSelectionDecision
}

data class PlayerModeUiState(
    val visible: Boolean = false,
    val options: List<PlaybackMode> = emptyList(),
    val preferredMode: PlaybackMode? = null,
    val actualMode: PlaybackMode? = null,
    val retainedIntentText: String? = null,
    val videoContentWarning: VideoContentWarning? = null
) {
    val isVideo: Boolean get() = actualMode == PlaybackMode.VIDEO

    fun selectionDecision(mode: PlaybackMode): ModeSelectionDecision {
        if (!visible || mode !in options || mode == actualMode) return ModeSelectionDecision.Ignore
        val warning = videoContentWarning
        return if (mode == PlaybackMode.VIDEO && warning != null) {
            ModeSelectionDecision.Confirm(mode, warning)
        } else {
            ModeSelectionDecision.Apply(mode)
        }
    }
}

private val themeModeOrder = listOf(
    PlaybackMode.TV_SIZE,
    PlaybackMode.FULL_SIZE,
    PlaybackMode.VIDEO
)

fun derivePlayerModeUiState(
    isTheme: Boolean,
    currentQueueId: Long? = playbackState.queueId,
    playbackState: PlaybackState
): PlayerModeUiState {
    if (!isTheme || playbackState.queueId != currentQueueId) return PlayerModeUiState()
    val options = themeModeOrder.filter(playbackState.availableModes::contains)
    val preferred = playbackState.preferredMode
    val actual = playbackState.actualMode
    val retainedText = if (
        playbackState.retainedIntentReason != null &&
        preferred != null && actual != null && preferred != actual
    ) {
        "${preferred.displayLabel()} preferred · playing ${actual.displayLabel()}"
    } else {
        null
    }
    val warning = if (playbackState.videoSpoiler || playbackState.videoNsfw) {
        VideoContentWarning(playbackState.videoSpoiler, playbackState.videoNsfw)
    } else {
        null
    }
    return PlayerModeUiState(
        visible = options.isNotEmpty(),
        options = options,
        preferredMode = preferred,
        actualMode = actual,
        retainedIntentText = retainedText,
        videoContentWarning = warning
    )
}

fun PlaybackMode.displayLabel(): String = when (this) {
    PlaybackMode.TV_SIZE -> "TV Size"
    PlaybackMode.FULL_SIZE -> "Full Size"
    PlaybackMode.VIDEO -> "Video"
    PlaybackMode.RELATED_AUDIO -> "Related Audio"
}

fun isFullscreenVideo(
    orientation: Int,
    isVideo: Boolean,
    isExpanded: Boolean
): Boolean = orientation == Configuration.ORIENTATION_LANDSCAPE && isVideo && isExpanded

data class VideoModeExit(
    val audioMode: PlaybackMode,
    val resumePlayback: Boolean
)

private data class VideoModeSession(
    val queueId: Long,
    val videoQueueVersion: Long,
    val priorAudioMode: PlaybackMode,
    val wasAudioPlaying: Boolean
)

class VideoModeSessionTracker {
    private var session: VideoModeSession? = null

    fun begin(
        queueId: Long,
        videoQueueVersion: Long,
        priorAudioMode: PlaybackMode,
        wasAudioPlaying: Boolean
    ) {
        require(priorAudioMode == PlaybackMode.TV_SIZE || priorAudioMode == PlaybackMode.FULL_SIZE)
        session = VideoModeSession(queueId, videoQueueVersion, priorAudioMode, wasAudioPlaying)
    }

    fun clear() {
        session = null
    }

    fun consumeExit(
        currentQueueId: Long?,
        currentQueueVersion: Long,
        videoRequested: Boolean
    ): VideoModeExit? {
        val captured = session.also { session = null } ?: return null
        if (
            !videoRequested ||
            captured.queueId != currentQueueId ||
            captured.videoQueueVersion != currentQueueVersion
        ) return null
        return VideoModeExit(captured.priorAudioMode, captured.wasAudioPlaying)
    }
}
