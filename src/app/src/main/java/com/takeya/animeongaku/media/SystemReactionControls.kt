package com.takeya.animeongaku.media

import androidx.media3.common.HeartRating
import androidx.media3.common.Rating
import androidx.media3.common.ThumbRating

/** The three reaction values exposed by the Android media-session controls. */
internal enum class SystemReaction {
    NONE,
    LIKE,
    DISLIKE
}

internal enum class SystemReactionAction {
    LIKE,
    DISLIKE,
    CLEAR
}

/** Identifies one queue occurrence and its preference record independently. */
internal data class SystemReactionTarget(
    val queueId: Long,
    val playableKey: PlayableKey
) {
    fun takeIfMediaIdMatches(mediaId: String?): SystemReactionTarget? {
        val requestedMediaId = mediaId?.trim().orEmpty()
        return if (requestedMediaId.isBlank() || requestedMediaId == queueId.toString()) this else null
    }
}

internal data class SystemReactionVisualState(
    val likeLabel: String,
    val dislikeLabel: String
)

internal fun captureSystemReactionTarget(
    queueId: Long,
    playableKey: PlayableKey
): SystemReactionTarget = SystemReactionTarget(queueId, playableKey)

/**
 * Maps Media3's standard ratings to an explicit desired reaction.
 * An unrated value is a clear operation; callers must never implement this as a toggle.
 */
internal fun reactionFromRating(rating: Rating): SystemReaction? = when (rating) {
    is ThumbRating -> if (!rating.isRated()) SystemReaction.NONE else {
        if (rating.isThumbsUp) SystemReaction.LIKE else SystemReaction.DISLIKE
    }
    is HeartRating -> if (!rating.isRated() || !rating.isHeart) SystemReaction.NONE else SystemReaction.LIKE
    else -> null
}

internal fun reactionFromCustomAction(action: SystemReactionAction): SystemReaction = when (action) {
    SystemReactionAction.LIKE -> SystemReaction.LIKE
    SystemReactionAction.DISLIKE -> SystemReaction.DISLIKE
    SystemReactionAction.CLEAR -> SystemReaction.NONE
}

internal fun likeButtonAction(reaction: SystemReaction): SystemReactionAction =
    if (reaction == SystemReaction.LIKE) SystemReactionAction.CLEAR else SystemReactionAction.LIKE

internal fun dislikeButtonAction(reaction: SystemReaction): SystemReactionAction =
    if (reaction == SystemReaction.DISLIKE) SystemReactionAction.CLEAR else SystemReactionAction.DISLIKE

internal fun reactionVisualState(reaction: SystemReaction): SystemReactionVisualState = when (reaction) {
    SystemReaction.NONE -> SystemReactionVisualState("Like", "Dislike")
    SystemReaction.LIKE -> SystemReactionVisualState("Unlike", "Dislike")
    SystemReaction.DISLIKE -> SystemReactionVisualState("Like", "Remove dislike")
}
