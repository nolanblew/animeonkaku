package com.takeya.animeongaku

import androidx.media3.common.HeartRating
import androidx.media3.common.ThumbRating
import com.takeya.animeongaku.media.PlayableKey
import com.takeya.animeongaku.media.PlayableKind
import com.takeya.animeongaku.media.SystemReaction
import com.takeya.animeongaku.media.SystemReactionAction
import com.takeya.animeongaku.media.SystemReactionTarget
import com.takeya.animeongaku.media.SystemReactionVisualState
import com.takeya.animeongaku.media.captureSystemReactionTarget
import com.takeya.animeongaku.media.dislikeButtonAction
import com.takeya.animeongaku.media.likeButtonAction
import com.takeya.animeongaku.media.reactionFromCustomAction
import com.takeya.animeongaku.media.reactionFromRating
import com.takeya.animeongaku.media.reactionVisualState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemReactionControlsTest {
    @Test
    fun `unrated standard rating clears the reaction`() {
        assertEquals(SystemReaction.NONE, reactionFromRating(ThumbRating()))
        assertEquals(SystemReaction.NONE, reactionFromRating(HeartRating()))
    }

    @Test
    fun `rated thumb and heart ratings map to desired states`() {
        assertEquals(SystemReaction.LIKE, reactionFromRating(ThumbRating(true)))
        assertEquals(SystemReaction.DISLIKE, reactionFromRating(ThumbRating(false)))
        assertEquals(SystemReaction.LIKE, reactionFromRating(HeartRating(true)))
        assertEquals(SystemReaction.NONE, reactionFromRating(HeartRating(false)))
    }

    @Test
    fun `custom action visuals expose each state without toggling semantics`() {
        assertEquals(
            SystemReactionVisualState("Like", "Dislike"),
            reactionVisualState(SystemReaction.NONE)
        )
        assertEquals(
            SystemReactionVisualState("Unlike", "Dislike"),
            reactionVisualState(SystemReaction.LIKE)
        )
        assertEquals(
            SystemReactionVisualState("Like", "Remove dislike"),
            reactionVisualState(SystemReaction.DISLIKE)
        )
    }

    @Test
    fun `target capture keeps queue occurrence identity`() {
        val target = captureSystemReactionTarget(
            queueId = 42L,
            playableKey = PlayableKey(PlayableKind.THEME, 7L)
        )

        assertEquals(SystemReactionTarget(42L, PlayableKey(PlayableKind.THEME, 7L)), target)
        assertTrue(target.queueId != target.playableKey.id)
    }

    @Test
    fun `media id mismatch cannot redirect a late command to another occurrence`() {
        val target = SystemReactionTarget(42L, PlayableKey(PlayableKind.SONG, 7L))

        assertNull(target.takeIfMediaIdMatches("43"))
        assertEquals(target, target.takeIfMediaIdMatches("42"))
        assertEquals(target, target.takeIfMediaIdMatches(""))
    }

    @Test
    fun `selected custom reaction buttons issue clear instead of toggling`() {
        assertEquals(SystemReactionAction.CLEAR, likeButtonAction(SystemReaction.LIKE))
        assertEquals(SystemReactionAction.CLEAR, dislikeButtonAction(SystemReaction.DISLIKE))
        assertEquals(SystemReaction.NONE, reactionFromCustomAction(SystemReactionAction.CLEAR))
    }
}
