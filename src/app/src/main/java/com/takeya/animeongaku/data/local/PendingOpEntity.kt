package com.takeya.animeongaku.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Durable outbox of local mutations made while offline (or to be confirmed online). Every
 * user change — like/dislike, playlist create/rename/reorder/delete, dynamic-playlist edit,
 * library add/remove — is applied optimistically to Room and also recorded here. The sync
 * engine drains this FIFO when a server connection is available, sending each op with its
 * client op-timestamp [opTs] so the server can resolve conflicts last-write-wins.
 *
 * Keeping the outbox separate from the mirrored entities means "offline" (device offline,
 * server down, or anything in between) is just "the queue hasn't drained yet".
 */
@Entity(tableName = "pending_ops")
data class PendingOpEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** Logical entity family: [ENTITY_THEME_PREF], [ENTITY_PLAYLIST], [ENTITY_LIBRARY], [ENTITY_PLAY]. */
    val entityType: String,
    /** Stable key within the family: themeId, local playlistId, or kitsuId. */
    val entityKey: String,
    /** [OP_UPSERT], [OP_DELETE], [OP_CREATE], [OP_RENAME], [OP_REORDER]. */
    val opType: String,
    /** Op-specific JSON payload (e.g. the new liked/disliked state, or the entry list). */
    val payloadJson: String,
    /** Client op-timestamp (epoch ms) of when the user acted — the last-write-wins clock. */
    val opTs: Long,
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0
) {
    companion object {
        const val ENTITY_THEME_PREF = "theme_pref"
        const val ENTITY_PLAYLIST = "playlist"
        const val ENTITY_LIBRARY = "library"
        const val ENTITY_PLAY = "play"

        const val OP_UPSERT = "upsert"
        const val OP_DELETE = "delete"
        const val OP_CREATE = "create"
        const val OP_RENAME = "rename"
        const val OP_REORDER = "reorder"
    }
}
