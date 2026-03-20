package com.takeya.animeongaku.ui.common

import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListItemInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay

@Composable
fun rememberDragDropState(
    lazyListState: LazyListState,
    onMove: (Any, Any) -> Boolean
): DragDropState {
    val currentOnMove by rememberUpdatedState(onMove)
    val state = remember(lazyListState) { DragDropState(lazyListState) { f, t -> currentOnMove(f, t) } }

    LaunchedEffect(state.draggingItemKey) {
        if (state.draggingItemKey != null) {
            while (true) {
                state.checkForScroll()
                delay(16)
            }
        }
    }

    return state
}

class DragDropState(
    private val state: LazyListState,
    private val onMove: (Any, Any) -> Boolean
) {
    var draggingItemKey by mutableStateOf<Any?>(null)
        private set

    private var draggingItemExpectedIndex = -1

    private var absoluteDragPosY by mutableFloatStateOf(0f)

    val draggingItemOffset: Float
        get() {
            val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == draggingItemKey }
            return if (item != null) {
                absoluteDragPosY - item.offset
            } else 0f
        }

    fun onDragStart(key: Any) {
        val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == key }
        if (item != null) {
            draggingItemKey = key
            absoluteDragPosY = item.offset.toFloat()
            draggingItemExpectedIndex = item.index
        }
    }

    fun onDragInterrupted() {
        draggingItemKey = null
        draggingItemExpectedIndex = -1
    }

    fun onDrag(offsetY: Float) {
        draggingItemKey ?: return
        absoluteDragPosY += offsetY
        // Clamp to the viewport so dragging the finger above or below the list
        // can't cause absoluteDragPosY to run away and produce uncontrollable scrolling.
        val viewportStart = state.layoutInfo.viewportStartOffset.toFloat()
        val viewportEnd = state.layoutInfo.viewportEndOffset.toFloat()
        absoluteDragPosY = absoluteDragPosY.coerceIn(viewportStart, viewportEnd)
        checkTargetItem()
    }

    suspend fun checkForScroll() {
        val draggedKey = draggingItemKey ?: return
        val currentItem = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == draggedKey } ?: return

        val viewportStart = state.layoutInfo.viewportStartOffset
        val viewportEnd = state.layoutInfo.viewportEndOffset
        val distanceToStart = absoluteDragPosY - viewportStart
        val distanceToEnd = viewportEnd - (absoluteDragPosY + currentItem.size)
        val threshold = 150f

        var scrollAmount = 0f
        if (distanceToStart < threshold) {
            scrollAmount = distanceToStart - threshold // negative
        } else if (distanceToEnd < threshold) {
            scrollAmount = threshold - distanceToEnd // positive
        }

        if (scrollAmount != 0f) {
            // Cap speed so the list can never scroll more than 20px per frame.
            val scrollByAmount = (scrollAmount * 0.15f).coerceIn(-20f, 20f)
            state.scrollBy(scrollByAmount)
            checkTargetItem()
        }
    }

    private fun checkTargetItem() {
        val draggedKey = draggingItemKey ?: return
        val currentItem = state.layoutInfo.visibleItemsInfo.firstOrNull { it.key == draggedKey } ?: return

        val centerOffset = absoluteDragPosY + currentItem.size / 2

        val targetItem = state.layoutInfo.visibleItemsInfo.find { item ->
            centerOffset > item.offset && centerOffset < item.offset + item.size
        }

        if (targetItem != null && targetItem.key != draggedKey) {
            if (targetItem.index == draggingItemExpectedIndex) {
                return
            }
            if (onMove(draggedKey, targetItem.key)) {
                // After a move, queue indices shift so each item's key changes.
                // The dragged item now occupies the target's former slot and inherits its key.
                // Update draggingItemKey so we continue tracking the right item.
                draggingItemKey = targetItem.key
                draggingItemExpectedIndex = targetItem.index
            }
        } else if (targetItem != null && targetItem.key == draggedKey) {
            draggingItemExpectedIndex = targetItem.index
        }
    }
}

fun Modifier.dragHandle(
    dragDropState: DragDropState,
    key: Any
): Modifier = this.pointerInput(key) {
    detectVerticalDragGestures(
        onDragStart = { dragDropState.onDragStart(key) },
        onDragCancel = { dragDropState.onDragInterrupted() },
        onDragEnd = { dragDropState.onDragInterrupted() },
        onVerticalDrag = { change, dragAmount ->
            change.consume()
            dragDropState.onDrag(dragAmount)
        }
    )
}

fun Modifier.dragDropItem(
    dragDropState: DragDropState,
    key: Any
): Modifier = this.graphicsLayer {
    if (dragDropState.draggingItemKey == key) {
        translationY = dragDropState.draggingItemOffset
        alpha = 0.8f
    }
}.zIndex(if (dragDropState.draggingItemKey == key) 1f else 0f)

