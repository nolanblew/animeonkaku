package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.media.QueueOp
import com.takeya.animeongaku.media.QueueEntry
import com.takeya.animeongaku.media.PlaybackIntent
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.media.computeQueueOps
import com.takeya.animeongaku.media.computeQueueEntryOps
import com.takeya.animeongaku.media.computeQueueOpsPreservingCurrent
import com.takeya.animeongaku.media.reusableResolvedQueueIdsForStructuralMutation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueDiffTest {
    @Test
    fun `reordering upcoming entries reuses resolved Full or Video media`() {
        val reusableIds = reusableResolvedQueueIdsForStructuralMutation(
            previousQueueEntryIds = listOf(10L, 11L, 12L, 13L),
            previousResolvedMediaIds = ids("10", "11", "12", "13"),
            previousCurrentQueueId = 11L,
            previousIntent = PlaybackIntent(sessionOverride = PlaybackMode.FULL_SIZE),
            nextQueueEntryIds = listOf(10L, 11L, 13L, 12L),
            nextCurrentQueueId = 11L,
            nextIntent = PlaybackIntent(sessionOverride = PlaybackMode.FULL_SIZE)
        )

        assertEquals(ids("10", "11", "13", "12"), reusableIds)
    }

    @Test
    fun `removing an upcoming entry reuses resolved media without touching current`() {
        val reusableIds = reusableResolvedQueueIdsForStructuralMutation(
            previousQueueEntryIds = listOf(20L, 21L, 22L, 23L),
            previousResolvedMediaIds = ids("20", "21", "22", "23"),
            previousCurrentQueueId = 21L,
            previousIntent = PlaybackIntent(sessionOverride = PlaybackMode.VIDEO),
            nextQueueEntryIds = listOf(20L, 21L, 23L),
            nextCurrentQueueId = 21L,
            nextIntent = PlaybackIntent(sessionOverride = PlaybackMode.VIDEO)
        )

        assertEquals(ids("20", "21", "23"), reusableIds)
    }

    @Test
    fun `new entries and mode changes require fresh resolution`() {
        val previousQueueIds = listOf(30L, 31L, 32L)
        val previousResolvedIds = ids("30", "31", "32")
        val fullIntent = PlaybackIntent(sessionOverride = PlaybackMode.FULL_SIZE)

        assertEquals(
            null,
            reusableResolvedQueueIdsForStructuralMutation(
                previousQueueEntryIds = previousQueueIds,
                previousResolvedMediaIds = previousResolvedIds,
                previousCurrentQueueId = 30L,
                previousIntent = fullIntent,
                nextQueueEntryIds = listOf(30L, 31L, 32L, 33L),
                nextCurrentQueueId = 30L,
                nextIntent = fullIntent
            )
        )
        assertEquals(
            null,
            reusableResolvedQueueIdsForStructuralMutation(
                previousQueueEntryIds = previousQueueIds,
                previousResolvedMediaIds = previousResolvedIds,
                previousCurrentQueueId = 30L,
                previousIntent = fullIntent,
                nextQueueEntryIds = previousQueueIds,
                nextCurrentQueueId = 30L,
                nextIntent = PlaybackIntent(sessionOverride = PlaybackMode.TV_SIZE)
            )
        )
    }


    @Test
    fun `typed queue diff uses occurrence ids not playable ids`() {
        val duplicate = ThemeEntity(1, null, "Same", null, "same.mp3", null, false, null)
        val old = listOf(QueueEntry(10, duplicate), QueueEntry(11, duplicate))
        val new = listOf(old[1], old[0])

        assertEquals(listOf(QueueOp.Move(0, 1)), computeQueueEntryOps(old, new))
    }

    private fun ids(vararg values: String): List<String> = values.toList()

    /**
     * Applies [ops] to [start] in order and returns the resulting list. Used to sanity-check
     * that every test case's op sequence actually transforms `old` into `new`.
     */
    private fun apply(start: List<String>, ops: List<QueueOp>): List<String> {
        val list = start.toMutableList()
        for (op in ops) {
            when (op) {
                is QueueOp.Add -> list.addAll(op.position, op.mediaIds)
                is QueueOp.Remove -> {
                    for (i in op.toIndex - 1 downTo op.fromIndex) list.removeAt(i)
                }
                is QueueOp.Move -> {
                    val item = list.removeAt(op.fromIndex)
                    list.add(op.toIndex, item)
                }
                is QueueOp.Replace -> list[op.position] = op.mediaId
            }
        }
        return list
    }

    private fun removedIds(start: List<String>, ops: List<QueueOp>): List<String> {
        val list = start.toMutableList()
        val removed = mutableListOf<String>()
        for (op in ops) {
            when (op) {
                is QueueOp.Add -> list.addAll(op.position, op.mediaIds)
                is QueueOp.Remove -> {
                    for (i in op.toIndex - 1 downTo op.fromIndex) {
                        removed += list.removeAt(i)
                    }
                }
                is QueueOp.Move -> {
                    val item = list.removeAt(op.fromIndex)
                    list.add(op.toIndex, item)
                }
                is QueueOp.Replace -> list[op.position] = op.mediaId
            }
        }
        return removed
    }

    // ─── identity ─────────────────────────────────────────────────────────────────

    @Test
    fun `identity returns empty ops`() {
        assertEquals(emptyList<QueueOp>(), computeQueueOps(ids("a", "b", "c"), ids("a", "b", "c")))
    }

    @Test
    fun `both empty returns empty ops`() {
        assertEquals(emptyList<QueueOp>(), computeQueueOps(emptyList(), emptyList()))
    }

    // ─── pure add ─────────────────────────────────────────────────────────────────

    @Test
    fun `empty to non-empty emits single Add at 0`() {
        val old = emptyList<String>()
        val new = ids("a", "b", "c")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Add(0, ids("a", "b", "c"))), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `append at end emits single Add`() {
        val old = ids("a", "b", "c")
        val new = ids("a", "b", "c", "d", "e")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Add(3, ids("d", "e"))), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `prepend at start emits single Add`() {
        val old = ids("c", "d")
        val new = ids("a", "b", "c", "d")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Add(0, ids("a", "b"))), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `insert in middle emits single Add`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("a", "b", "x", "y", "c", "d")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Add(2, ids("x", "y"))), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `single-item insert after current simulates playNext`() {
        // Current at index 0 = "cur", upcoming = [u1, u2]. Play Next inserts "new" at 1.
        val old = ids("cur", "u1", "u2")
        val new = ids("cur", "new", "u1", "u2")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Add(1, ids("new"))), ops)
        assertEquals(new, apply(old, ops))
    }

    // ─── pure remove ──────────────────────────────────────────────────────────────

    @Test
    fun `non-empty to empty emits single Remove`() {
        val old = ids("a", "b", "c")
        val new = emptyList<String>()
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Remove(0, 3)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `remove range at start emits single Remove`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("c", "d")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Remove(0, 2)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `remove range at end emits single Remove`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("a", "b")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Remove(2, 4)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `remove in middle emits single Remove`() {
        val old = ids("a", "b", "c", "d", "e")
        val new = ids("a", "b", "e")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Remove(2, 4)), ops)
        assertEquals(new, apply(old, ops))
    }

    // ─── replace ──────────────────────────────────────────────────────────────────

    @Test
    fun `single element replacement emits Replace`() {
        val old = ids("a", "b", "c")
        val new = ids("a", "x", "c")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Replace(1, "x")), ops)
        assertEquals(new, apply(old, ops))
    }

    // ─── single-item move (drag-drop) ─────────────────────────────────────────────

    @Test
    fun `adjacent swap emits single Move forward`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("a", "c", "b", "d")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Move(1, 2)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `longer forward move emits single Move`() {
        val old = ids("a", "b", "c", "d", "e", "f")
        val new = ids("a", "c", "d", "e", "b", "f")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Move(1, 4)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `backward move emits single Move`() {
        val old = ids("a", "b", "c", "d", "e", "f")
        val new = ids("a", "e", "b", "c", "d", "f")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Move(4, 1)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `move to head emits single Move`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("c", "a", "b", "d")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Move(2, 0)), ops)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `move to tail emits single Move`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("a", "c", "d", "b")
        val ops = computeQueueOps(old, new)
        assertEquals(listOf(QueueOp.Move(1, 3)), ops)
        assertEquals(new, apply(old, ops))
    }

    // ─── arbitrary permutation fallback ───────────────────────────────────────────

    @Test
    fun `double swap falls back to Remove + Add`() {
        val old = ids("a", "b", "c", "d")
        val new = ids("a", "d", "c", "b")
        val ops = computeQueueOps(old, new)
        // Prefix = [a], suffix = []; middle differs and isn't a single move, so remove+add.
        assertEquals(2, ops.size)
        assertTrue(ops[0] is QueueOp.Remove)
        assertTrue(ops[1] is QueueOp.Add)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `large shuffle with fixed head produces two ops`() {
        // Simulates toggleShuffle: current item pinned at index 0, everything else permuted.
        // Seeded Random makes the shuffle deterministic; the seed is chosen so that the
        // permutation differs from the original at both ends, but the test still tolerates
        // whatever incidental common prefix/suffix the diff strips.
        val tail = (1..100).map { "t$it" }
        val old = ids("cur") + tail
        val new = ids("cur") + tail.shuffled(kotlin.random.Random(seed = 42))
        val ops = computeQueueOps(old, new)

        // With the fixed head "cur" still at index 0, the diff must be a single Remove+Add
        // pair over the shuffled region.
        assertEquals(2, ops.size)
        assertTrue(ops[0] is QueueOp.Remove)
        assertTrue(ops[1] is QueueOp.Add)
        val remove = ops[0] as QueueOp.Remove
        assertTrue("Remove.fromIndex should be >= 1 (prefix 'cur')", remove.fromIndex >= 1)
        assertTrue("Remove.toIndex should be <= 101", remove.toIndex <= 101)
        assertTrue("Remove range should be non-empty", remove.fromIndex < remove.toIndex)
        assertEquals(new, apply(old, ops))
    }

    @Test
    fun `shuffle from advanced current item does not remove current media item`() {
        val old = ids("q1", "q2", "q3", "q4", "q5", "q6")
        val new = ids("q4", "q6", "q2", "q5", "q3")

        val ops = computeQueueOpsPreservingCurrent(
            old = old,
            new = new,
            currentMediaId = "q4",
            desiredCurrentIndex = 0
        )

        assertEquals(new, apply(old, ops))
        assertFalse(
            "Queue diff must preserve the playing item so shuffle does not restart it",
            removedIds(old, ops).contains("q4")
        )
    }

    @Test
    fun `cold startup expands queue before moving current to a distant restored index`() {
        val old = ids("current")
        val restoredPrefix = (0 until 63).map { "before-$it" }
        val new = restoredPrefix + "current" + ids("after-1", "after-2")

        val ops = computeQueueOpsPreservingCurrent(
            old = old,
            new = new,
            currentMediaId = "current",
            desiredCurrentIndex = 63
        )

        assertEquals(new, apply(old, ops))
        assertFalse(
            "Cold-start queue sync must retain the active Media3 occurrence",
            removedIds(old, ops).contains("current")
        )
    }

    @Test
    fun `mixed insert and remove falls back to Remove + Add`() {
        val old = ids("a", "b", "c", "d", "e")
        val new = ids("a", "x", "y", "z", "e")
        val ops = computeQueueOps(old, new)
        assertEquals(
            listOf(
                QueueOp.Remove(1, 4),
                QueueOp.Add(1, ids("x", "y", "z"))
            ),
            ops
        )
        assertEquals(new, apply(old, ops))
    }
}
