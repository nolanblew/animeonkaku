package com.takeya.animeongaku

import com.takeya.animeongaku.ui.common.draggedKeyAfterAcceptedMove
import org.junit.Assert.assertEquals
import org.junit.Test

class DragDropListTest {
    @Test
    fun `accepted reorder keeps tracking the originally dragged stable key`() {
        val draggedKey = "queue-1"
        val targetKey = "queue-2"

        assertEquals(draggedKey, draggedKeyAfterAcceptedMove(draggedKey, targetKey))
    }
}
