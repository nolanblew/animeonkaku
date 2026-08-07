package com.takeya.animeongaku.media

/**
 * Bounded-size sequence of operations that transforms one ordered list of media IDs into another.
 *
 * The algorithm produces a single op for the supported fast paths — append/prepend/insert,
 * single-range remove, single-element replace, and single-item relocation — and falls back
 * to `[Remove, Add]` for any other delta (including permutations that a smarter algorithm
 * could express as several moves). This keeps the per-mutation IPC count to at most two
 * batched Media3 calls without attempting LCS-style minimization.
 *
 * Indices are expressed against the list state **after** prior ops in the returned list
 * have been applied, so the caller applies them in order.
 */
sealed class QueueOp {
    /** Insert [mediaIds] starting at [position]. */
    data class Add(val position: Int, val mediaIds: List<String>) : QueueOp()
    /** Remove items in range [fromIndex, toIndex). */
    data class Remove(val fromIndex: Int, val toIndex: Int) : QueueOp()
    /** Move the item at [fromIndex] so it ends up at [toIndex] after the move. */
    data class Move(val fromIndex: Int, val toIndex: Int) : QueueOp()
    /** Swap the item at [position] for a new one with [mediaId]. */
    data class Replace(val position: Int, val mediaId: String) : QueueOp()
}

/** Queue diff adapter that deliberately compares occurrence identity, never playable identity. */
fun computeQueueEntryOps(old: List<QueueEntry>, new: List<QueueEntry>): List<QueueOp> =
    computeQueueOps(old.map { it.queueId.toString() }, new.map { it.queueId.toString() })

/**
 * Computes a minimal sequence of [QueueOp]s that transforms [old] into [new].
 *
 * Strategy: strip the longest common prefix and suffix, then emit one op (or two) for the
 * remaining middle region. A single-item relocation inside the middle region is detected
 * and emitted as a single [QueueOp.Move] so drag-drop and moveToPlayNext translate to a
 * single IPC call that preserves session metadata better than remove+add.
 */
fun computeQueueOps(old: List<String>, new: List<String>): List<QueueOp> {
    if (old === new || old == new) return emptyList()

    if (old.isEmpty()) {
        return listOf(QueueOp.Add(0, new.toList()))
    }
    if (new.isEmpty()) {
        return listOf(QueueOp.Remove(0, old.size))
    }

    // Longest common prefix
    var prefix = 0
    val minLen = minOf(old.size, new.size)
    while (prefix < minLen && old[prefix] == new[prefix]) prefix++

    // Longest common suffix (not overlapping the prefix on either side)
    var suffix = 0
    while (
        suffix < old.size - prefix &&
        suffix < new.size - prefix &&
        old[old.size - 1 - suffix] == new[new.size - 1 - suffix]
    ) suffix++

    val oldMidEnd = old.size - suffix
    val newMidEnd = new.size - suffix
    val oldMid = old.subList(prefix, oldMidEnd)
    val newMid = new.subList(prefix, newMidEnd)

    // Pure add (insertion only)
    if (oldMid.isEmpty()) {
        return listOf(QueueOp.Add(prefix, newMid.toList()))
    }

    // Pure remove
    if (newMid.isEmpty()) {
        return listOf(QueueOp.Remove(prefix, oldMidEnd))
    }

    // Single in-place replacement
    if (oldMid.size == 1 && newMid.size == 1) {
        return listOf(QueueOp.Replace(prefix, newMid[0]))
    }

    // Single-item relocation inside the middle region (drag-drop / moveToPlayNext)
    if (oldMid.size == newMid.size && oldMid.size >= 2) {
        // Forward move: oldMid[0] slides to the end of newMid; everything else shifts left by 1.
        if (
            oldMid[0] == newMid[newMid.size - 1] &&
            oldMid.subList(1, oldMid.size) == newMid.subList(0, newMid.size - 1)
        ) {
            return listOf(QueueOp.Move(prefix, prefix + oldMid.size - 1))
        }
        // Backward move: oldMid[last] slides to the start of newMid; everything else shifts right by 1.
        if (
            oldMid[oldMid.size - 1] == newMid[0] &&
            oldMid.subList(0, oldMid.size - 1) == newMid.subList(1, newMid.size)
        ) {
            return listOf(QueueOp.Move(prefix + oldMid.size - 1, prefix))
        }
    }

    // Fallback: arbitrary permutation or mixed insert/remove — a single batched
    // remove + batched add covers it in two IPC calls.
    return listOf(
        QueueOp.Remove(prefix, oldMidEnd),
        QueueOp.Add(prefix, newMid.toList())
    )
}

/**
 * Variant of [computeQueueOps] for playback queue updates where [currentMediaId] is already
 * playing and must not be removed/re-added. Removing the active item forces Media3 to load it
 * again from the beginning, which is especially visible when shuffling after several tracks have
 * already played.
 */
fun computeQueueOpsPreservingCurrent(
    old: List<String>,
    new: List<String>,
    currentMediaId: String?,
    desiredCurrentIndex: Int
): List<QueueOp> {
    if (currentMediaId == null) return computeQueueOps(old, new)
    if (old == new) return emptyList()

    val oldCurrentIndex = old.indexOf(currentMediaId)
    val newCurrentIndex = new.indexOf(currentMediaId)
    if (oldCurrentIndex < 0 || newCurrentIndex < 0 || newCurrentIndex != desiredCurrentIndex) {
        return computeQueueOps(old, new)
    }

    val ops = mutableListOf<QueueOp>()
    val working = old.toMutableList()
    if (oldCurrentIndex != desiredCurrentIndex) {
        ops += QueueOp.Move(oldCurrentIndex, desiredCurrentIndex)
        val current = working.removeAt(oldCurrentIndex)
        working.add(desiredCurrentIndex, current)
    }

    val beforeOld = working.subList(0, desiredCurrentIndex).toList()
    val beforeNew = new.subList(0, desiredCurrentIndex)
    val beforeOps = computeQueueOps(beforeOld, beforeNew)
    ops += beforeOps
    applyQueueOps(working, beforeOps)

    val afterStart = desiredCurrentIndex + 1
    val afterOld = working.subList(afterStart, working.size).toList()
    val afterNew = new.subList(afterStart, new.size)
    ops += computeQueueOps(afterOld, afterNew).map { it.offset(afterStart) }

    return ops
}

private fun QueueOp.offset(offset: Int): QueueOp = when (this) {
    is QueueOp.Add -> copy(position = position + offset)
    is QueueOp.Remove -> copy(fromIndex = fromIndex + offset, toIndex = toIndex + offset)
    is QueueOp.Move -> copy(fromIndex = fromIndex + offset, toIndex = toIndex + offset)
    is QueueOp.Replace -> copy(position = position + offset)
}

private fun applyQueueOps(items: MutableList<String>, ops: List<QueueOp>) {
    for (op in ops) {
        when (op) {
            is QueueOp.Add -> items.addAll(op.position, op.mediaIds)
            is QueueOp.Remove -> {
                for (index in op.toIndex - 1 downTo op.fromIndex) {
                    items.removeAt(index)
                }
            }
            is QueueOp.Move -> {
                val item = items.removeAt(op.fromIndex)
                items.add(op.toIndex, item)
            }
            is QueueOp.Replace -> items[op.position] = op.mediaId
        }
    }
}
