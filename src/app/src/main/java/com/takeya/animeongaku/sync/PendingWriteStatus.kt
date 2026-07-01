package com.takeya.animeongaku.sync

data class PendingWriteStatus(
    val pendingCount: Int = 0,
    val retriedCount: Int = 0,
    val isOnline: Boolean = true
) {
    val hasPending: Boolean = pendingCount > 0
    val hasRetried: Boolean = retriedCount > 0
    val message: String? = pendingWriteStatusMessage(pendingCount, retriedCount, isOnline)
}

internal fun pendingWriteStatusMessage(
    pendingCount: Int,
    retriedCount: Int,
    isOnline: Boolean
): String? {
    if (pendingCount <= 0) return null
    val noun = if (pendingCount == 1) "change" else "changes"
    return when {
        !isOnline -> "Saved on this phone. $pendingCount playlist $noun will sync when you're back online."
        retriedCount > 0 -> "Saved on this phone. Retrying $pendingCount playlist $noun with the server."
        else -> "Syncing $pendingCount playlist $noun."
    }
}
