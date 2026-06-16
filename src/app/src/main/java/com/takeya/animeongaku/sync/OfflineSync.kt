package com.takeya.animeongaku.sync

/**
 * Pure offline-first sync rules shared by the client sync engine. Kept side-effect-free so the
 * conflict and id-remap logic is unit-testable in isolation (mirrors the server's `sync/lww.ts`).
 */
object OfflineSync {

    /**
     * Last-write-wins for an incoming server delta vs. the locally-held value. Apply the incoming
     * row only if it is at least as new as the local op clock; a local edit that hasn't synced yet
     * (newer [localTs]) is preserved so the user's offline change isn't clobbered by a stale pull.
     */
    fun shouldApplyIncoming(incomingTs: Long, localTs: Long?): Boolean {
        if (localTs == null) return true
        return incomingTs >= localTs
    }

    /** Offline-created entities use a temporary negative id until the server assigns a real one. */
    fun isTempId(id: Long): Boolean = id < 0

    /** Allocate a temporary, collision-free negative id for an offline-created entity. */
    fun tempIdFrom(seed: Long): Long = -(seed and Long.MAX_VALUE).coerceAtLeast(1)

    /** Replace every occurrence of a temporary id with the server-assigned id (entry lists, etc.). */
    fun remapId(ids: List<Long>, tempId: Long, serverId: Long): List<Long> =
        ids.map { if (it == tempId) serverId else it }
}
