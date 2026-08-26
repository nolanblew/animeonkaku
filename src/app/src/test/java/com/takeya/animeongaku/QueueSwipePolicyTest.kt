package com.takeya.animeongaku

import androidx.compose.material3.SwipeToDismissBoxValue
import com.takeya.animeongaku.ui.player.canSwipeQueueEntryToRemove
import com.takeya.animeongaku.ui.player.queueSwipeDismissThreshold
import com.takeya.animeongaku.ui.player.shouldRemoveQueueEntryAfterSwipeSettles
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueSwipePolicyTest {
    @Test
    fun `only upcoming queue entries can be swiped away`() {
        assertTrue(canSwipeQueueEntryToRemove(queueIndex = 4, currentIndex = 2))
        assertFalse(canSwipeQueueEntryToRemove(queueIndex = 2, currentIndex = 2))
        assertFalse(canSwipeQueueEntryToRemove(queueIndex = 1, currentIndex = 2))
        assertFalse(canSwipeQueueEntryToRemove(queueIndex = -1, currentIndex = 2))
    }

    @Test
    fun `queue swipe requires half of the row width on every screen size`() {
        assertEquals(180f, queueSwipeDismissThreshold(totalDistance = 360f), 0.001f)
        assertEquals(540f, queueSwipeDismissThreshold(totalDistance = 1080f), 0.001f)
    }

    @Test
    fun `queue removal waits until the dismiss animation has settled`() {
        assertFalse(
            shouldRemoveQueueEntryAfterSwipeSettles(
                enabled = true,
                settledValue = SwipeToDismissBoxValue.Settled
            )
        )
        assertTrue(
            shouldRemoveQueueEntryAfterSwipeSettles(
                enabled = true,
                settledValue = SwipeToDismissBoxValue.EndToStart
            )
        )
        assertFalse(
            shouldRemoveQueueEntryAfterSwipeSettles(
                enabled = false,
                settledValue = SwipeToDismissBoxValue.EndToStart
            )
        )
    }
}
