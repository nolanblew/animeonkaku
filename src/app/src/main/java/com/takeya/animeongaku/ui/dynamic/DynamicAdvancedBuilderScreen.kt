@file:OptIn(ExperimentalMaterial3Api::class)

package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.NodePath
import com.takeya.animeongaku.data.filter.NodeRow
import com.takeya.animeongaku.data.filter.Op
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.filter.insertAt
import com.takeya.animeongaku.data.filter.leafSummary
import com.takeya.animeongaku.data.filter.nodeAt
import com.takeya.animeongaku.data.filter.removeAt
import com.takeya.animeongaku.data.filter.replaceAt
import com.takeya.animeongaku.data.filter.toNodeRows
import com.takeya.animeongaku.data.filter.wrapAt
import com.takeya.animeongaku.ui.theme.Gold400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.ui.theme.Sky500

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

@Composable
fun DynamicAdvancedBuilderScreen(
    onNavigateToPreview: () -> Unit,
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()

    val backgroundBrush = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val tree = state.advancedTree
    val nodeRows = tree.toNodeRows()

    var editingPath by remember { mutableStateOf<NodePath?>(null) }
    var editingNode by remember { mutableStateOf<FilterNode?>(null) }
    var addingToParentPath by remember { mutableStateOf<NodePath?>(null) }
    var choosingLeafForPath by remember { mutableStateOf<NodePath?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(brush = backgroundBrush)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(bottom = 100.dp)
        ) {
            item {
                TopBarRow(
                    onBack = onBack,
                    onPreview = onNavigateToPreview
                )
            }
            items(nodeRows, key = { row -> rowKey(row) }) { row ->
                when (row) {
                    is NodeRow.OperatorHeader -> OperatorHeaderRow(
                        row = row,
                        tree = tree,
                        onTreeChange = { viewModel.setAdvancedTree(it) }
                    )
                    is NodeRow.Leaf -> LeafRow(
                        row = row,
                        onEdit = {
                            editingPath = row.path
                            editingNode = row.node
                        },
                        onDelete = {
                            viewModel.setAdvancedTree(tree.removeAt(row.path))
                        }
                    )
                    is NodeRow.AddChildSlot -> AddChildSlotRow(
                        row = row,
                        onAdd = { choosingLeafForPath = row.parentPath }
                    )
                }
            }
            item { Spacer(modifier = Modifier.height(16.dp)) }
        }

        PreviewCountBar(
            count = preview.count,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
        )
    }

    // Leaf picker sheet
    choosingLeafForPath?.let { parentPath ->
        LeafTypePickerSheet(
            onDismiss = { choosingLeafForPath = null },
            onTypeChosen = { prototype ->
                choosingLeafForPath = null
                addingToParentPath = parentPath
                editingNode = prototype
                editingPath = null
            }
        )
    }

    // Leaf editor sheet
    val effectivePath = editingPath
    val effectiveNode = editingNode
    if (effectiveNode != null) {
        LeafEditorSheet(
            node = effectiveNode,
            availableGenres = state.availableGenres,
            onDismiss = {
                editingPath = null
                editingNode = null
                addingToParentPath = null
            },
            onConfirm = { newLeaf ->
                val ep = effectivePath
                val ap = addingToParentPath
                val newTree = when {
                    ep != null -> tree.replaceAt(ep, newLeaf)
                    ap != null -> tree.insertAt(ap, newLeaf)
                    else -> tree
                }
                viewModel.setAdvancedTree(newTree)
                editingPath = null
                editingNode = null
                addingToParentPath = null
            }
        )
    }
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

@Composable
private fun TopBarRow(onBack: () -> Unit, onPreview: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(onClick = onBack) {
            Icon(Icons.Rounded.ArrowBack, contentDescription = "Back", tint = Mist100)
        }
        Text(
            text = "Advanced Filters",
            color = Mist100,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f).padding(start = 4.dp)
        )
        Button(
            onClick = onPreview,
            colors = ButtonDefaults.buttonColors(containerColor = Rose500),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Preview", color = Color.White, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.width(4.dp))
            Icon(Icons.Rounded.ArrowForward, contentDescription = null, tint = Color.White)
        }
    }
}

// ---------------------------------------------------------------------------
// Operator header row
// ---------------------------------------------------------------------------

@Composable
private fun OperatorHeaderRow(
    row: NodeRow.OperatorHeader,
    tree: FilterNode,
    onTreeChange: (FilterNode) -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }
    val badgeColor = when (row.op) {
        Op.AND -> Rose500
        Op.OR -> Gold400
        Op.NOT -> Sky500
    }
    val label = when (row.op) {
        Op.AND -> "AND"
        Op.OR -> "OR"
        Op.NOT -> "NOT"
    }
    val countSuffix = if (row.op != Op.NOT) " (${row.childCount} conditions)" else ""

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (row.depth * 16).dp, end = 8.dp, top = 6.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            color = badgeColor.copy(alpha = 0.2f),
            shape = RoundedCornerShape(6.dp)
        ) {
            Text(
                text = "$label$countSuffix",
                color = badgeColor,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
            )
        }
        Spacer(modifier = Modifier.weight(1f))
        Box {
            IconButton(onClick = { menuExpanded = true }) {
                Icon(Icons.Rounded.MoreVert, contentDescription = "Operator options", tint = Mist200)
            }
            OperatorDropdownMenu(
                expanded = menuExpanded,
                op = row.op,
                onDismiss = { menuExpanded = false },
                onWrapInNot = {
                    menuExpanded = false
                    onTreeChange(tree.wrapAt(row.path) { FilterNode.Not(it) })
                },
                onToggleAndOr = {
                    menuExpanded = false
                    val node = when (row.op) {
                        Op.AND -> {
                            val children = (tree as? FilterNode.And)?.children
                                ?: (tree.nodeAt(row.path) as? FilterNode.And)?.children
                                ?: emptyList()
                            FilterNode.Or(children)
                        }
                        Op.OR -> {
                            val children = (tree.nodeAt(row.path) as? FilterNode.Or)?.children
                                ?: emptyList()
                            FilterNode.And(children)
                        }
                        Op.NOT -> return@OperatorDropdownMenu
                    }
                    onTreeChange(tree.replaceAt(row.path, node))
                },
                onDelete = {
                    menuExpanded = false
                    onTreeChange(tree.removeAt(row.path))
                }
            )
        }
    }
}

@Composable
private fun OperatorDropdownMenu(
    expanded: Boolean,
    op: Op,
    onDismiss: () -> Unit,
    onWrapInNot: () -> Unit,
    onToggleAndOr: () -> Unit,
    onDelete: () -> Unit
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        containerColor = Ink800
    ) {
        DropdownMenuItem(
            text = { Text("Wrap in NOT", color = Mist100) },
            onClick = onWrapInNot,
            colors = MenuDefaults.itemColors()
        )
        if (op == Op.AND || op == Op.OR) {
            val switchLabel = if (op == Op.AND) "Change to OR" else "Change to AND"
            DropdownMenuItem(
                text = { Text(switchLabel, color = Mist100) },
                onClick = onToggleAndOr,
                colors = MenuDefaults.itemColors()
            )
        }
        DropdownMenuItem(
            text = { Text("Delete group", color = Rose500) },
            onClick = onDelete,
            colors = MenuDefaults.itemColors()
        )
    }
}

// ---------------------------------------------------------------------------
// Leaf row
// ---------------------------------------------------------------------------

@Composable
private fun LeafRow(
    row: NodeRow.Leaf,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (row.depth * 16).dp + 4.dp, end = 8.dp, top = 4.dp, bottom = 4.dp)
            .clickable(onClick = onEdit),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = row.node.leafSummary(),
            color = Mist100,
            fontSize = 14.sp,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = onEdit) {
            Icon(Icons.Rounded.Edit, contentDescription = "Edit", tint = Mist200)
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Rounded.Delete, contentDescription = "Delete", tint = Rose500)
        }
    }
}

// ---------------------------------------------------------------------------
// Add child slot row
// ---------------------------------------------------------------------------

@Composable
private fun AddChildSlotRow(row: NodeRow.AddChildSlot, onAdd: () -> Unit) {
    TextButton(
        onClick = onAdd,
        modifier = Modifier.padding(start = (row.depth * 16).dp)
    ) {
        Text("＋ Add filter…", color = Sky500, fontSize = 13.sp)
    }
}

// ---------------------------------------------------------------------------
// Preview count bar
// ---------------------------------------------------------------------------

@Composable
private fun PreviewCountBar(count: Int, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Ink800),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "$count matching tracks",
                color = Mist200,
                fontSize = 14.sp
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Leaf type picker bottom sheet
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LeafTypePickerSheet(
    onDismiss: () -> Unit,
    onTypeChosen: (FilterNode) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    data class LeafOption(val label: String, val prototype: FilterNode)

    val options = listOf(
        LeafOption("Genre", FilterNode.GenreIn(emptyList())),
        LeafOption("Aired Before", FilterNode.AiredBefore(2000)),
        LeafOption("Aired After", FilterNode.AiredAfter(2000)),
        LeafOption("Aired Between", FilterNode.AiredBetween(2000, 2020)),
        LeafOption("Season", FilterNode.SeasonIn(emptyList())),
        LeafOption("Media Type", FilterNode.SubtypeIn(emptyList())),
        LeafOption("Rating (Avg)", FilterNode.AverageRatingGte(7.0)),
        LeafOption("Rating (Mine)", FilterNode.UserRatingGte(7.0)),
        LeafOption("Watching Status", FilterNode.WatchingStatusIn(emptyList())),
        LeafOption("Library Updated Within", FilterNode.LibraryUpdatedWithin(30L * 24 * 60 * 60 * 1000)),
        LeafOption("Theme Type", FilterNode.ThemeTypeIn(emptyList())),
        LeafOption("Artist", FilterNode.ArtistIn(emptyList())),
        LeafOption("Liked", FilterNode.Liked),
        LeafOption("Disliked", FilterNode.Disliked),
        LeafOption("Downloaded", FilterNode.Downloaded),
        LeafOption("Play Count", FilterNode.PlayCountGte(5)),
        LeafOption("Played Since", FilterNode.PlayedSince(System.currentTimeMillis() - 30L * 24 * 60 * 60 * 1000))
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink800
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                "Choose filter type",
                color = Mist100,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                options.forEach { opt ->
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Ink700,
                        modifier = Modifier.clickable { onTypeChosen(opt.prototype) }
                    ) {
                        Text(
                            text = opt.label,
                            color = Mist100,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

// ---------------------------------------------------------------------------
// Leaf editor bottom sheet
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LeafEditorSheet(
    node: FilterNode,
    availableGenres: List<com.takeya.animeongaku.data.local.GenreEntity>,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink800
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            when (node) {
                is FilterNode.GenreIn ->
                    GenreEditor(node, availableGenres, onDismiss, onConfirm)
                is FilterNode.AiredBefore ->
                    SingleYearEditor("Aired before (year)", node.year, onDismiss) {
                        onConfirm(FilterNode.AiredBefore(it))
                    }
                is FilterNode.AiredAfter ->
                    SingleYearEditor("Aired after (year)", node.year, onDismiss) {
                        onConfirm(FilterNode.AiredAfter(it))
                    }
                is FilterNode.AiredBetween ->
                    YearRangeEditor(node.minYear, node.maxYear, onDismiss) { min, max ->
                        onConfirm(FilterNode.AiredBetween(min, max))
                    }
                is FilterNode.SeasonIn ->
                    SeasonEditor(node, onDismiss, onConfirm)
                is FilterNode.SubtypeIn ->
                    SubtypeEditor(node, onDismiss, onConfirm)
                is FilterNode.AverageRatingGte ->
                    RatingEditor("Average Rating >=", node.min, onDismiss) {
                        onConfirm(FilterNode.AverageRatingGte(it))
                    }
                is FilterNode.UserRatingGte ->
                    RatingEditor("My Rating >=", node.min, onDismiss) {
                        onConfirm(FilterNode.UserRatingGte(it))
                    }
                is FilterNode.WatchingStatusIn ->
                    WatchingStatusEditor(node, onDismiss, onConfirm)
                is FilterNode.LibraryUpdatedWithin ->
                    DaysEditor("Library updated within (days)", node.durationMillis / (24 * 60 * 60 * 1000L), onDismiss) {
                        onConfirm(FilterNode.LibraryUpdatedWithin(it * 24 * 60 * 60 * 1000L))
                    }
                is FilterNode.ThemeTypeIn ->
                    ThemeTypeEditor(node, onDismiss, onConfirm)
                is FilterNode.ArtistIn ->
                    ArtistEditor(node, onDismiss, onConfirm)
                is FilterNode.PlayCountGte ->
                    IntegerEditor("Played at least (count)", node.min, onDismiss) {
                        onConfirm(FilterNode.PlayCountGte(it))
                    }
                FilterNode.Liked, FilterNode.Disliked, FilterNode.Downloaded ->
                    NoConfigEditor(node, onDismiss, onConfirm)
                else ->
                    NoConfigEditor(node, onDismiss, onConfirm)
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

// ---------------------------------------------------------------------------
// Individual leaf editors
// ---------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenreEditor(
    node: FilterNode.GenreIn,
    genres: List<com.takeya.animeongaku.data.local.GenreEntity>,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.slugs.toSet()) }
    var matchAll by remember { mutableStateOf(node.matchAll) }

    EditorTitle("Genres")
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        genres.forEach { genre ->
            val isSelected = genre.slug in selected
            FilterChip(
                selected = isSelected,
                onClick = {
                    selected = if (isSelected) selected - genre.slug else selected + genre.slug
                },
                label = { Text(genre.displayName, color = if (isSelected) Ink900 else Mist200) },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(false to "Match ANY", true to "Match ALL").forEach { (all, label) ->
            val isSelected = matchAll == all
            FilterChip(
                selected = isSelected,
                onClick = { matchAll = all },
                label = { Text(label, color = if (isSelected) Ink900 else Mist200) },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    ConfirmButton {
        onConfirm(FilterNode.GenreIn(selected.toList(), matchAll))
    }
}

@Composable
private fun SingleYearEditor(
    title: String,
    initial: Int,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit
) {
    var text by remember { mutableStateOf(initial.toString()) }
    EditorTitle(title)
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Year", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton {
        onConfirm(text.toIntOrNull() ?: initial)
    }
}

@Composable
private fun YearRangeEditor(
    initialMin: Int,
    initialMax: Int,
    onDismiss: () -> Unit,
    onConfirm: (Int, Int) -> Unit
) {
    var minText by remember { mutableStateOf(initialMin.toString()) }
    var maxText by remember { mutableStateOf(initialMax.toString()) }
    EditorTitle("Aired between")
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        OutlinedTextField(
            value = minText,
            onValueChange = { minText = it },
            singleLine = true,
            label = { Text("From", color = Mist200) },
            modifier = Modifier.weight(1f),
            colors = editorTextFieldColors()
        )
        OutlinedTextField(
            value = maxText,
            onValueChange = { maxText = it },
            singleLine = true,
            label = { Text("To", color = Mist200) },
            modifier = Modifier.weight(1f),
            colors = editorTextFieldColors()
        )
    }
    ConfirmButton {
        onConfirm(
            minText.toIntOrNull() ?: initialMin,
            maxText.toIntOrNull() ?: initialMax
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SeasonEditor(
    node: FilterNode.SeasonIn,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.seasons.toSet()) }
    EditorTitle("Season")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Season.entries.forEach { season ->
            val isSelected = season in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - season else selected + season },
                label = {
                    Text(
                        season.name.lowercase().replaceFirstChar { it.uppercaseChar() },
                        color = if (isSelected) Ink900 else Mist200
                    )
                },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(FilterNode.SeasonIn(selected.toList())) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubtypeEditor(
    node: FilterNode.SubtypeIn,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.subtypes.toSet()) }
    EditorTitle("Media Type")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("tv", "movie", "ova", "ona", "special").forEach { type ->
            val isSelected = type in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - type else selected + type },
                label = { Text(type.uppercase(), color = if (isSelected) Ink900 else Mist200) },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(FilterNode.SubtypeIn(selected.toList())) }
}

@Composable
private fun RatingEditor(
    title: String,
    initial: Double,
    onDismiss: () -> Unit,
    onConfirm: (Double) -> Unit
) {
    var value by remember { mutableStateOf(initial.toFloat()) }
    EditorTitle(title)
    Text("${"%.1f".format(value)}", color = Mist100, fontWeight = FontWeight.SemiBold)
    Slider(
        value = value,
        onValueChange = { value = it },
        valueRange = 0f..10f,
        steps = 19,
        modifier = Modifier.fillMaxWidth(),
        colors = SliderDefaults.colors(
            thumbColor = Rose500,
            activeTrackColor = Rose500,
            inactiveTrackColor = Ink700
        )
    )
    ConfirmButton { onConfirm(value.toDouble()) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WatchingStatusEditor(
    node: FilterNode.WatchingStatusIn,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.statuses.toSet()) }
    EditorTitle("Watching Status")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(
            "current" to "Current",
            "completed" to "Completed",
            "on_hold" to "On Hold",
            "dropped" to "Dropped",
            "planned" to "Plan to Watch"
        ).forEach { (status, label) ->
            val isSelected = status in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - status else selected + status },
                label = { Text(label, color = if (isSelected) Ink900 else Mist200) },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(FilterNode.WatchingStatusIn(selected.toList())) }
}

@Composable
private fun DaysEditor(
    title: String,
    initialDays: Long,
    onDismiss: () -> Unit,
    onConfirm: (Long) -> Unit
) {
    var text by remember { mutableStateOf(initialDays.toString()) }
    EditorTitle(title)
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Days", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton { onConfirm(text.toLongOrNull() ?: initialDays) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThemeTypeEditor(
    node: FilterNode.ThemeTypeIn,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.types.toSet()) }
    EditorTitle("Theme Type")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("OP" to "Opening", "ED" to "Ending", "IN" to "Insert").forEach { (type, label) ->
            val isSelected = type in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - type else selected + type },
                label = { Text(label, color = if (isSelected) Ink900 else Mist200) },
                colors = advancedChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(FilterNode.ThemeTypeIn(selected.toList())) }
}

@Composable
private fun ArtistEditor(
    node: FilterNode.ArtistIn,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    var text by remember { mutableStateOf(node.artistNames.joinToString(", ")) }
    EditorTitle("Artist(s)")
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = false,
        label = { Text("Comma-separated artist names", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton {
        val artists = text.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        onConfirm(FilterNode.ArtistIn(artists))
    }
}

@Composable
private fun IntegerEditor(
    title: String,
    initial: Int,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit
) {
    var text by remember { mutableStateOf(initial.toString()) }
    EditorTitle(title)
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Count", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton { onConfirm(text.toIntOrNull() ?: initial) }
}

@Composable
private fun NoConfigEditor(
    node: FilterNode,
    onDismiss: () -> Unit,
    onConfirm: (FilterNode) -> Unit
) {
    EditorTitle(node.leafSummary())
    Text("No additional configuration needed.", color = Mist200, fontSize = 14.sp)
    ConfirmButton { onConfirm(node) }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

@Composable
private fun EditorTitle(title: String) {
    Text(title, color = Mist100, fontWeight = FontWeight.Bold, fontSize = 18.sp)
}

@Composable
private fun ConfirmButton(onClick: () -> Unit) {
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(containerColor = Rose500)
    ) {
        Text("Confirm", color = Color.White, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun advancedChipColors(selected: Boolean) = FilterChipDefaults.filterChipColors(
    selectedContainerColor = Rose500,
    selectedLabelColor = Color.White,
    containerColor = Color(0xFF252530),
    labelColor = Mist200
)

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun editorTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Rose500,
    unfocusedBorderColor = Mist200,
    focusedTextColor = Mist100,
    unfocusedTextColor = Mist100
)

private fun rowKey(row: NodeRow): String = when (row) {
    is NodeRow.OperatorHeader -> "op-${row.path.joinToString("-")}-${row.op}"
    is NodeRow.Leaf -> "leaf-${row.path.joinToString("-")}"
    is NodeRow.AddChildSlot -> "add-${row.parentPath.joinToString("-")}"
}
