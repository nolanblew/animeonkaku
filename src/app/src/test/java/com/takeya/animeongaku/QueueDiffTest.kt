package com.takeya.animeongaku

import com.takeya.animeongaku.media.QueueOp
import com.takeya.animeongaku.media.computeQueueOps
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueDiffTest {

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
        val old = ids("cur") + (1..100).map { "t$it" }
        val new = ids("cur") + (1..100).map { "t$it" }.shuffled()
        val ops = computeQueueOps(old, new)
        if (old == new) {
            // Extremely unlikely but guard against flakiness
            assertTrue(ops.isEmpty())
        } else {
            assertEquals(2, ops.size)
            assertTrue(ops[0] is QueueOp.Remove)
            assertTrue(ops[1] is QueueOp.Add)
            val remove = ops[0] as QueueOp.Remove
            assertEquals(1, remove.fromIndex)
            assertEquals(101, remove.toIndex)
        }
        assertEquals(new, apply(old, ops))
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
