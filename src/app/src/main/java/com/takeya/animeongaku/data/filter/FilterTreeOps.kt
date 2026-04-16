package com.takeya.animeongaku.data.filter

typealias NodePath = List<Int>

/** Replace the node at [path] with [replacement]. Root path = emptyList(). */
fun FilterNode.replaceAt(path: NodePath, replacement: FilterNode): FilterNode {
    if (path.isEmpty()) return replacement
    val idx = path.first()
    val rest = path.drop(1)
    return when (this) {
        is FilterNode.And -> FilterNode.And(children.mapIndexed { i, child ->
            if (i == idx) child.replaceAt(rest, replacement) else child
        })
        is FilterNode.Or -> FilterNode.Or(children.mapIndexed { i, child ->
            if (i == idx) child.replaceAt(rest, replacement) else child
        })
        is FilterNode.Not -> if (idx == 0) FilterNode.Not(child.replaceAt(rest, replacement)) else this
        else -> this // leaf — path out of range, no-op
    }
}

/** Insert [child] into the operator node at [parentPath]. */
fun FilterNode.insertAt(parentPath: NodePath, child: FilterNode): FilterNode {
    if (parentPath.isEmpty()) {
        return when (this) {
            is FilterNode.And -> FilterNode.And(children + child)
            is FilterNode.Or -> FilterNode.Or(children + child)
            is FilterNode.Not -> this // Not takes only one child
            else -> FilterNode.And(listOf(this, child))
        }
    }
    val idx = parentPath.first()
    val rest = parentPath.drop(1)
    return when (this) {
        is FilterNode.And -> FilterNode.And(children.mapIndexed { i, c ->
            if (i == idx) c.insertAt(rest, child) else c
        })
        is FilterNode.Or -> FilterNode.Or(children.mapIndexed { i, c ->
            if (i == idx) c.insertAt(rest, child) else c
        })
        is FilterNode.Not -> FilterNode.Not(child.insertAt(rest, child))
        else -> this
    }
}

/** Remove the node at [path] from its parent operator. Returns the modified tree. */
fun FilterNode.removeAt(path: NodePath): FilterNode {
    if (path.isEmpty()) return FilterNode.And(emptyList()) // removing root -> empty And
    if (path.size == 1) {
        val idx = path.first()
        return when (this) {
            is FilterNode.And -> FilterNode.And(children.filterIndexed { i, _ -> i != idx })
            is FilterNode.Or -> FilterNode.Or(children.filterIndexed { i, _ -> i != idx })
            is FilterNode.Not -> FilterNode.And(emptyList()) // removing Not's child -> empty And
            else -> this
        }
    }
    val idx = path.first()
    val rest = path.drop(1)
    return when (this) {
        is FilterNode.And -> FilterNode.And(children.mapIndexed { i, c ->
            if (i == idx) c.removeAt(rest) else c
        })
        is FilterNode.Or -> FilterNode.Or(children.mapIndexed { i, c ->
            if (i == idx) c.removeAt(rest) else c
        })
        is FilterNode.Not -> FilterNode.Not(child.removeAt(rest))
        else -> this
    }
}

/** Wrap the node at [path] with [wrapper] (e.g. wrap in Not). */
fun FilterNode.wrapAt(path: NodePath, wrapper: (FilterNode) -> FilterNode): FilterNode {
    if (path.isEmpty()) return wrapper(this)
    val target = nodeAt(path) ?: return this
    return replaceAt(path, wrapper(target))
}

/** Get the node at [path], or null if path is invalid. */
fun FilterNode.nodeAt(path: NodePath): FilterNode? {
    if (path.isEmpty()) return this
    val idx = path.first()
    val rest = path.drop(1)
    val child = when (this) {
        is FilterNode.And -> children.getOrNull(idx)
        is FilterNode.Or -> children.getOrNull(idx)
        is FilterNode.Not -> if (idx == 0) child else null
        else -> null
    } ?: return null
    return child.nodeAt(rest)
}

/** Flatten a FilterNode tree into a list of NodeRow items for display. */
sealed interface NodeRow {
    data class OperatorHeader(
        val op: Op,
        val depth: Int,
        val path: NodePath,
        val childCount: Int
    ) : NodeRow

    data class Leaf(
        val node: FilterNode,
        val depth: Int,
        val path: NodePath
    ) : NodeRow

    data class AddChildSlot(
        val parentPath: NodePath,
        val depth: Int
    ) : NodeRow
}

enum class Op { AND, OR, NOT }

fun FilterNode.toNodeRows(depth: Int = 0, path: NodePath = emptyList()): List<NodeRow> {
    return when (this) {
        is FilterNode.And -> {
            val header = NodeRow.OperatorHeader(Op.AND, depth, path, children.size)
            val childRows = children.flatMapIndexed { i, child -> child.toNodeRows(depth + 1, path + i) }
            val addSlot = NodeRow.AddChildSlot(path, depth + 1)
            listOf(header) + childRows + listOf(addSlot)
        }
        is FilterNode.Or -> {
            val header = NodeRow.OperatorHeader(Op.OR, depth, path, children.size)
            val childRows = children.flatMapIndexed { i, child -> child.toNodeRows(depth + 1, path + i) }
            val addSlot = NodeRow.AddChildSlot(path, depth + 1)
            listOf(header) + childRows + listOf(addSlot)
        }
        is FilterNode.Not -> {
            val header = NodeRow.OperatorHeader(Op.NOT, depth, path, 1)
            val childRows = child.toNodeRows(depth + 1, path + 0)
            listOf(header) + childRows
        }
        else -> listOf(NodeRow.Leaf(this, depth, path))
    }
}

/** Human-readable summary for a leaf node (for list display). */
fun FilterNode.leafSummary(): String = when (this) {
    is FilterNode.GenreIn -> "Genre = ${slugs.joinToString(", ")}${if (matchAll) " (all)" else ""}"
    is FilterNode.AiredBefore -> "Aired before $year"
    is FilterNode.AiredAfter -> "Aired after ${year - 1}"
    is FilterNode.AiredBetween -> "Aired $minYear-$maxYear"
    is FilterNode.SeasonIn -> "Season = ${seasons.joinToString(", ") { it.name.lowercase().replaceFirstChar { c -> c.uppercaseChar() } }}"
    is FilterNode.SubtypeIn -> "Type = ${subtypes.joinToString(", ")}"
    is FilterNode.AverageRatingGte -> "Avg rating >= ${"%.1f".format(min)}"
    is FilterNode.UserRatingGte -> "My rating >= ${"%.1f".format(min)}"
    is FilterNode.WatchingStatusIn -> "Status = ${statuses.joinToString(", ")}"
    is FilterNode.LibraryUpdatedAfter -> "Watched after (specific date)"
    is FilterNode.LibraryUpdatedWithin -> "Watched within last period"
    is FilterNode.ThemeTypeIn -> "Theme type = ${types.joinToString(", ")}"
    is FilterNode.ArtistIn -> "Artist = ${artistNames.joinToString(", ")}"
    FilterNode.Liked -> "Liked"
    FilterNode.Disliked -> "Disliked"
    FilterNode.Downloaded -> "Downloaded"
    is FilterNode.PlayCountGte -> "Played >= $min times"
    is FilterNode.PlayedSince -> "Played recently"
    is FilterNode.And -> "AND (${children.size} conditions)"
    is FilterNode.Or -> "OR (${children.size} conditions)"
    is FilterNode.Not -> "NOT"
}
