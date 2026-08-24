package com.takeya.animeongaku

import com.takeya.animeongaku.ui.player.canSwipeQueueEntryToRemove
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
}
