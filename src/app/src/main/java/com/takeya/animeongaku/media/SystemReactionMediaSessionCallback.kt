package com.takeya.animeongaku.media

import android.os.Bundle
import androidx.media3.common.Rating
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.takeya.animeongaku.R

/** Shared Media3 protocol for the bounded Like/Dislike layout. */
@UnstableApi
internal object SystemReactionSessionCommands {
    const val LIKE_ACTION = "com.takeya.animeongaku.action.LIKE"
    const val DISLIKE_ACTION = "com.takeya.animeongaku.action.DISLIKE"
    const val CLEAR_ACTION = "com.takeya.animeongaku.action.CLEAR"

    val like = SessionCommand(LIKE_ACTION, Bundle())
    val dislike = SessionCommand(DISLIKE_ACTION, Bundle())
    val clear = SessionCommand(CLEAR_ACTION, Bundle())
    val available = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
        .add(like)
        .add(dislike)
        .add(clear)
        .build()

    fun layout(reaction: SystemReaction, enabled: Boolean): List<CommandButton> {
        val labels = reactionVisualState(reaction)
        return listOf(
            CommandButton.Builder()
                .setSessionCommand(if (likeButtonAction(reaction) == SystemReactionAction.CLEAR) clear else like)
                .setIconResId(if (reaction == SystemReaction.LIKE) R.drawable.ic_thumb_up_filled else R.drawable.ic_thumb_up)
                .setDisplayName(labels.likeLabel)
                .setEnabled(enabled)
                .build(),
            CommandButton.Builder()
                .setSessionCommand(if (dislikeButtonAction(reaction) == SystemReactionAction.CLEAR) clear else dislike)
                .setIconResId(if (reaction == SystemReaction.DISLIKE) R.drawable.ic_thumb_down_filled else R.drawable.ic_thumb_down)
                .setDisplayName(labels.dislikeLabel)
                .setEnabled(enabled)
                .build()
        )
    }
}

/** Reaction-only MediaSession callback. Playback and queue policy stays in the owning service. */
@UnstableApi
internal open class SystemReactionMediaSessionCallback(
    private val currentTarget: () -> SystemReactionTarget?,
    private val submitReaction: (SystemReactionTarget, SystemReaction) -> ListenableFuture<SessionResult>,
    private val currentLayout: () -> List<CommandButton>
) : MediaSession.Callback {
    override fun onConnect(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo
    ): MediaSession.ConnectionResult = MediaSession.ConnectionResult.AcceptedResultBuilder(mediaSession)
        .setAvailableSessionCommands(SystemReactionSessionCommands.available)
        .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
        .setCustomLayout(currentLayout())
        .build()

    override fun onCustomCommand(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        command: SessionCommand,
        args: Bundle
    ): ListenableFuture<SessionResult> {
        val reaction = when (command.customAction) {
            SystemReactionSessionCommands.LIKE_ACTION -> SystemReaction.LIKE
            SystemReactionSessionCommands.DISLIKE_ACTION -> SystemReaction.DISLIKE
            SystemReactionSessionCommands.CLEAR_ACTION -> SystemReaction.NONE
            else -> return immediate(SessionResult.RESULT_ERROR_NOT_SUPPORTED)
        }
        return submit(currentTarget(), reaction)
    }

    override fun onSetRating(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaId: String,
        rating: Rating
    ): ListenableFuture<SessionResult> = submitRating(currentTarget()?.takeIfMediaIdMatches(mediaId), rating)

    override fun onSetRating(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        rating: Rating
    ): ListenableFuture<SessionResult> = submitRating(currentTarget(), rating)

    private fun submitRating(
        target: SystemReactionTarget?,
        rating: Rating
    ): ListenableFuture<SessionResult> {
        val reaction = reactionFromRating(rating)
            ?: return immediate(SessionResult.RESULT_ERROR_NOT_SUPPORTED)
        return submit(target, reaction)
    }

    private fun submit(target: SystemReactionTarget?, reaction: SystemReaction): ListenableFuture<SessionResult> =
        target?.let { submitReaction(it, reaction) } ?: immediate(SessionResult.RESULT_ERROR_INVALID_STATE)

    private fun immediate(code: Int): ListenableFuture<SessionResult> =
        SettableFuture.create<SessionResult>().also { it.set(SessionResult(code)) }
}
