@file:OptIn(ExperimentalMaterial3Api::class)

package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.RemoveCircleOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.filter.FilterNode
import com.takeya.animeongaku.data.filter.NodePath
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.filter.insertAt
import com.takeya.animeongaku.data.filter.nodeAt
import com.takeya.animeongaku.data.filter.removeAt
import com.takeya.animeongaku.data.filter.replaceAt
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.theme.Gold400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.ui.theme.Sky500
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable
fun DynamicAdvancedBuilderScreen(
    onNavigateToPreview: () -> Unit,
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()
    val validationMessage by viewModel.validationMessage.collectAsStateWithLifecycle()

    val tree = state.advancedTree
    val scrollState = rememberScrollState()

    var editingPath by remember { mutableStateOf<NodePath?>(null) }
    var editingNode by remember { mutableStateOf<FilterNode?>(null) }
    var attributeTargetPath by remember { mutableStateOf<NodePath?>(null) }
    var leafInsertParentPath by remember { mutableStateOf<NodePath?>(null) }
    var groupTargetPath by remember { mutableStateOf<NodePath?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Ink900, Ink800, Ink700)))
    ) {
        LogicCanvasBackdrop()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            AdvancedTopBar(onBack = onBack)
            Text(
                text = "Build logic with nested groups. Add attributes, switch AND or OR gates, or negate an entire group.",
                color = Mist200,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(scrollState)
                    .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = MiniPlayerHeight + 128.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                LogicCanvasNode(
                    node = tree,
                    path = emptyList(),
                    depth = 0,
                    isRoot = true,
                    onEditLeaf = { path, node ->
                        editingPath = path
                        editingNode = node
                    },
                    onDeleteNode = { path ->
                        viewModel.setAdvancedTree(tree.removeAt(path))
                    },
                    onChangeGroupOp = { path, useAnd ->
                        viewModel.setAdvancedTree(changeGroupOperator(tree, path, useAnd))
                    },
                    onAddNegation = { path ->
                        viewModel.setAdvancedTree(wrapWithNegation(tree, path))
                    },
                    onRemoveNegation = { path ->
                        viewModel.setAdvancedTree(removeNegationLayer(tree, path))
                    },
                    onAddAttribute = { attributeTargetPath = it },
                    onAddGroup = { groupTargetPath = it }
                )
            }
        }

        FloatingActionButton(
            onClick = { attributeTargetPath = emptyList() },
            containerColor = Color(0xFF121217),
            contentColor = Rose500,
            shape = CircleShape,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 24.dp, bottom = MiniPlayerHeight + 110.dp)
                .size(64.dp)
        ) {
            Icon(Icons.Rounded.Add, contentDescription = "Add rule", modifier = Modifier.size(28.dp))
        }

        AdvancedResultsBar(
            count = preview.count,
            validationMessage = validationMessage,
            onSaveLogic = onNavigateToPreview,
            enabled = validationMessage == null,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(bottom = MiniPlayerHeight)
                .navigationBarsPadding()
        )
    }

    attributeTargetPath?.let { parentPath ->
        AttributeTypePickerSheet(
            onDismiss = { attributeTargetPath = null },
            onTypeChosen = { prototype ->
                attributeTargetPath = null
                editingPath = null
                leafInsertParentPath = parentPath
                editingNode = prototype
            }
        )
    }

    groupTargetPath?.let { parentPath ->
        GroupTypePickerSheet(
            onDismiss = { groupTargetPath = null },
            onTypeChosen = { useAnd ->
                val groupNode = if (useAnd) {
                    FilterNode.And(emptyList())
                } else {
                    FilterNode.Or(emptyList())
                }
                viewModel.setAdvancedTree(tree.insertAt(parentPath, groupNode))
                groupTargetPath = null
            }
        )
    }

    val nodeBeingEdited = editingNode
    val pathBeingEdited = editingPath
    if (nodeBeingEdited != null) {
        LeafEditorSheet(
            node = nodeBeingEdited,
            availableGenres = state.availableGenres,
            onDismiss = {
                editingNode = null
                editingPath = null
                leafInsertParentPath = null
            },
            onConfirm = { newLeaf ->
                val updatedTree = if (pathBeingEdited != null) {
                    tree.replaceAt(pathBeingEdited, newLeaf)
                } else if (leafInsertParentPath != null) {
                    tree.insertAt(leafInsertParentPath!!, newLeaf)
                } else {
                    tree.insertAt(emptyList(), newLeaf)
                }
                viewModel.setAdvancedTree(updatedTree)
                editingNode = null
                editingPath = null
                leafInsertParentPath = null
            }
        )
    }
}

@Composable
private fun LogicCanvasBackdrop() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Rose500.copy(alpha = 0.10f), Color.Transparent),
                    radius = 900f
                )
            )
    )
}

@Composable
private fun AdvancedTopBar(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp)
    ) {
        IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(Icons.Rounded.ArrowBack, contentDescription = "Back", tint = Mist100)
        }
        Text(
            text = "Logic Builder",
            color = Mist100,
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Center)
        )
    }
}

@Composable
private fun AdvancedResultsBar(
    count: Int,
    validationMessage: String?,
    onSaveLogic: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.padding(horizontal = 12.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF121217)),
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 10.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "RESULTS",
                    color = Mist200,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = if (validationMessage == null) {
                        "Previewing $count matching tracks"
                    } else {
                        validationMessage
                    },
                    color = Mist100,
                    fontSize = if (validationMessage == null) 18.sp else 14.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = if (validationMessage == null) 24.sp else 20.sp
                )
            }
            Button(
                onClick = onSaveLogic,
                enabled = enabled,
                shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF181820),
                    contentColor = Rose500,
                    disabledContainerColor = Color(0xFF181820),
                    disabledContentColor = Mist200.copy(alpha = 0.7f)
                )
            ) {
                Text("Save Logic", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun LogicCanvasNode(
    node: FilterNode,
    path: NodePath,
    depth: Int,
    isRoot: Boolean,
    onEditLeaf: (NodePath, FilterNode) -> Unit,
    onDeleteNode: (NodePath) -> Unit,
    onChangeGroupOp: (NodePath, Boolean) -> Unit,
    onAddNegation: (NodePath) -> Unit,
    onRemoveNegation: (NodePath) -> Unit,
    onAddAttribute: (NodePath) -> Unit,
    onAddGroup: (NodePath) -> Unit
) {
    when (node) {
        is FilterNode.And -> LogicGroupCard(
            node = node,
            path = path,
            depth = depth,
            isRoot = isRoot,
            groupLabel = "AND",
            accent = Rose500,
            onEditLeaf = onEditLeaf,
            onDeleteNode = onDeleteNode,
            onChangeGroupOp = onChangeGroupOp,
            onAddNegation = onAddNegation,
            onRemoveNegation = onRemoveNegation,
            onAddAttribute = onAddAttribute,
            onAddGroup = onAddGroup
        )
        is FilterNode.Or -> LogicGroupCard(
            node = node,
            path = path,
            depth = depth,
            isRoot = isRoot,
            groupLabel = "OR",
            accent = Gold400,
            onEditLeaf = onEditLeaf,
            onDeleteNode = onDeleteNode,
            onChangeGroupOp = onChangeGroupOp,
            onAddNegation = onAddNegation,
            onRemoveNegation = onRemoveNegation,
            onAddAttribute = onAddAttribute,
            onAddGroup = onAddGroup
        )
        is FilterNode.Not -> NegatedGroupCard(
            node = node,
            path = path,
            depth = depth,
            isRoot = isRoot,
            onEditLeaf = onEditLeaf,
            onDeleteNode = onDeleteNode,
            onChangeGroupOp = onChangeGroupOp,
            onAddNegation = onAddNegation,
            onRemoveNegation = onRemoveNegation,
            onAddAttribute = onAddAttribute,
            onAddGroup = onAddGroup
        )
        else -> AttributeNodeCard(
            node = node,
            path = path,
            onEdit = { onEditLeaf(path, node) },
            onDelete = { onDeleteNode(path) },
            onWrapInNot = { onAddNegation(path) }
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogicGroupCard(
    node: FilterNode,
    path: NodePath,
    depth: Int,
    isRoot: Boolean,
    groupLabel: String,
    accent: Color,
    onEditLeaf: (NodePath, FilterNode) -> Unit,
    onDeleteNode: (NodePath) -> Unit,
    onChangeGroupOp: (NodePath, Boolean) -> Unit,
    onAddNegation: (NodePath) -> Unit,
    onRemoveNegation: (NodePath) -> Unit,
    onAddAttribute: (NodePath) -> Unit,
    onAddGroup: (NodePath) -> Unit
) {
    val children = when (node) {
        is FilterNode.And -> node.children
        is FilterNode.Or -> node.children
        else -> emptyList()
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (depth * 4).dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF17171D)),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.30f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            GroupHeaderRow(
                path = path,
                isRoot = isRoot,
                groupLabel = groupLabel,
                accent = accent,
                onChangeGroupOp = onChangeGroupOp,
                onAddNegation = onAddNegation,
                onDeleteNode = onDeleteNode
            )

            if (children.isEmpty()) {
                Text(
                    text = "This group is empty. Add a filter or another group to keep building the flow.",
                    color = Mist200,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    children.forEachIndexed { index, child ->
                        if (index > 0) {
                            GateConnector(label = groupLabel, accent = accent)
                        }
                        LogicCanvasNode(
                            node = child,
                            path = path + index,
                            depth = depth + 1,
                            isRoot = false,
                            onEditLeaf = onEditLeaf,
                            onDeleteNode = onDeleteNode,
                            onChangeGroupOp = onChangeGroupOp,
                            onAddNegation = onAddNegation,
                            onRemoveNegation = onRemoveNegation,
                            onAddAttribute = onAddAttribute,
                            onAddGroup = onAddGroup
                        )
                    }
                }
            }

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                CanvasActionChip(
                    label = "Attribute",
                    tint = accent,
                    onClick = { onAddAttribute(path) }
                )
                CanvasActionChip(
                    label = "Group",
                    tint = Sky500,
                    onClick = { onAddGroup(path) }
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NegatedGroupCard(
    node: FilterNode.Not,
    path: NodePath,
    depth: Int,
    isRoot: Boolean,
    onEditLeaf: (NodePath, FilterNode) -> Unit,
    onDeleteNode: (NodePath) -> Unit,
    onChangeGroupOp: (NodePath, Boolean) -> Unit,
    onAddNegation: (NodePath) -> Unit,
    onRemoveNegation: (NodePath) -> Unit,
    onAddAttribute: (NodePath) -> Unit,
    onAddGroup: (NodePath) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = (depth * 4).dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF17171D)),
        shape = RoundedCornerShape(20.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF8B1E2B))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                GateBadge(label = "NOT", accent = Color(0xFFD6404D))
                Spacer(modifier = Modifier.weight(1f))
                TextButton(onClick = { onRemoveNegation(path) }) {
                    Icon(
                        Icons.Rounded.RemoveCircleOutline,
                        contentDescription = null,
                        tint = Mist200,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Remove NOT", color = Mist200)
                }
                if (!isRoot) {
                    IconButton(onClick = { onDeleteNode(path) }) {
                        Icon(Icons.Rounded.Delete, contentDescription = "Delete group", tint = Color(0xFFD6404D))
                    }
                }
            }
            Text(
                text = "Everything inside this block is excluded from the results.",
                color = Mist200,
                fontSize = 13.sp
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                CanvasActionChip(
                    label = "Add NOT",
                    tint = Color(0xFFD6404D),
                    onClick = { onAddNegation(path) }
                )
            }
            LogicCanvasNode(
                node = node.child,
                path = path + 0,
                depth = depth + 1,
                isRoot = false,
                onEditLeaf = onEditLeaf,
                onDeleteNode = onDeleteNode,
                onChangeGroupOp = onChangeGroupOp,
                onAddNegation = onAddNegation,
                onRemoveNegation = onRemoveNegation,
                onAddAttribute = onAddAttribute,
                onAddGroup = onAddGroup
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GroupHeaderRow(
    path: NodePath,
    isRoot: Boolean,
    groupLabel: String,
    accent: Color,
    onChangeGroupOp: (NodePath, Boolean) -> Unit,
    onAddNegation: (NodePath) -> Unit,
    onDeleteNode: (NodePath) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(
                text = if (isRoot) "ROOT GROUP" else "LOGIC GROUP",
                color = Mist200,
                fontSize = 11.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(modifier = Modifier.height(8.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GateSelectorChip(
                    label = "AND",
                    selected = groupLabel == "AND",
                    accent = Rose500,
                    onClick = { onChangeGroupOp(path, true) }
                )
                GateSelectorChip(
                    label = "OR",
                    selected = groupLabel == "OR",
                    accent = Gold400,
                    onClick = { onChangeGroupOp(path, false) }
                )
                CanvasActionChip(
                    label = "Add NOT",
                    tint = Color(0xFFD6404D),
                    onClick = { onAddNegation(path) }
                )
            }
        }
        Spacer(modifier = Modifier.weight(1f))
        if (!isRoot) {
            IconButton(onClick = { onDeleteNode(path) }) {
                Icon(Icons.Rounded.Delete, contentDescription = "Delete group", tint = accent)
            }
        }
    }
}

@Composable
private fun GateConnector(label: String, accent: Color) {
    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        GateBadge(label = label, accent = accent)
    }
}

@Composable
private fun AttributeNodeCard(
    node: FilterNode,
    path: NodePath,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onWrapInNot: () -> Unit
) {
    val accent = attributeAccent(node)
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onEdit),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A20)),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.28f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "ATTRIBUTE",
                        color = Mist200,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = attributeTitle(node),
                        color = Mist100,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = attributeValue(node),
                        color = Mist200,
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                var menuExpanded by remember(path) { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { menuExpanded = true }) {
                        Icon(Icons.Rounded.MoreVert, contentDescription = "Node actions", tint = Mist200)
                    }
                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false },
                        containerColor = Ink800
                    ) {
                        DropdownMenuItem(
                            text = { Text("Edit", color = Mist100) },
                            leadingIcon = {
                                Icon(Icons.Rounded.Edit, contentDescription = null, tint = Mist200)
                            },
                            onClick = {
                                menuExpanded = false
                                onEdit()
                            },
                            colors = MenuDefaults.itemColors()
                        )
                        DropdownMenuItem(
                            text = { Text("Add NOT", color = Mist100) },
                            leadingIcon = {
                                Icon(Icons.Rounded.RemoveCircleOutline, contentDescription = null, tint = Color(0xFFD6404D))
                            },
                            onClick = {
                                menuExpanded = false
                                onWrapInNot()
                            },
                            colors = MenuDefaults.itemColors()
                        )
                        DropdownMenuItem(
                            text = { Text("Delete", color = Rose500) },
                            leadingIcon = {
                                Icon(Icons.Rounded.Delete, contentDescription = null, tint = Rose500)
                            },
                            onClick = {
                                menuExpanded = false
                                onDelete()
                            },
                            colors = MenuDefaults.itemColors()
                        )
                    }
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth(0.72f)
                    .height(4.dp)
                    .background(accent, RoundedCornerShape(999.dp))
            )
        }
    }
}

@Composable
private fun GateBadge(label: String, accent: Color) {
    Surface(
        color = accent.copy(alpha = 0.18f),
        shape = RoundedCornerShape(999.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, accent.copy(alpha = 0.32f))
    ) {
        Text(
            text = label,
            color = accent,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
        )
    }
}

@Composable
private fun GateSelectorChip(
    label: String,
    selected: Boolean,
    accent: Color,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        color = if (selected) accent.copy(alpha = 0.20f) else Color(0xFF202028),
        shape = RoundedCornerShape(999.dp),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (selected) accent.copy(alpha = 0.50f) else Mist200.copy(alpha = 0.16f)
        )
    ) {
        Text(
            text = label,
            color = if (selected) accent else Mist200,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
        )
    }
}

@Composable
private fun CanvasActionChip(
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        color = tint.copy(alpha = 0.12f),
        shape = RoundedCornerShape(999.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, tint.copy(alpha = 0.28f))
    ) {
        Text(
            text = label,
            color = tint,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
        )
    }
}

private fun changeGroupOperator(tree: FilterNode, path: NodePath, useAnd: Boolean): FilterNode {
    return when (val node = tree.nodeAt(path)) {
        is FilterNode.And -> if (useAnd) tree else tree.replaceAt(path, FilterNode.Or(node.children))
        is FilterNode.Or -> if (!useAnd) tree else tree.replaceAt(path, FilterNode.And(node.children))
        else -> tree
    }
}

private fun wrapWithNegation(tree: FilterNode, path: NodePath): FilterNode {
    val node = tree.nodeAt(path) ?: return tree
    return tree.replaceAt(path, FilterNode.Not(node))
}

private fun removeNegationLayer(tree: FilterNode, path: NodePath): FilterNode {
    val node = tree.nodeAt(path) as? FilterNode.Not ?: return tree
    return tree.replaceAt(path, node.child)
}

private fun attributeTitle(node: FilterNode): String = when (node) {
    is FilterNode.GenreIn -> "Genre"
    is FilterNode.AiredBefore -> "Aired Before"
    is FilterNode.AiredAfter -> "Aired After"
    is FilterNode.AiredBetween -> "Aired Between"
    is FilterNode.SeasonIn -> "Season"
    is FilterNode.SubtypeIn -> "Media Type"
    is FilterNode.AverageRatingGte -> "Average Rating"
    is FilterNode.UserRatingGte -> "My Rating"
    is FilterNode.WatchingStatusIn -> "Watching Status"
    is FilterNode.LibraryUpdatedAfter -> "Watched After"
    is FilterNode.LibraryUpdatedWithin -> "Watched Recently"
    is FilterNode.ThemeTypeIn -> "Theme Type"
    is FilterNode.ArtistIn -> "Artist"
    is FilterNode.Liked -> "Liked"
    is FilterNode.Disliked -> "Disliked"
    is FilterNode.Downloaded -> "Downloaded"
    is FilterNode.PlayCountGte -> "Play Count"
    is FilterNode.PlayedSince -> "Played Since"
    else -> "Filter"
}

private fun attributeValue(node: FilterNode): String = when (node) {
    is FilterNode.GenreIn -> node.slugs.joinToString(", ").ifBlank { "Pick one or more genres" }
    is FilterNode.AiredBefore -> "Before ${node.year}"
    is FilterNode.AiredAfter -> "${node.year}+"
    is FilterNode.AiredBetween -> "${node.minYear} to ${node.maxYear}"
    is FilterNode.SeasonIn -> node.seasons.joinToString(", ") { it.name.lowercase().replaceFirstChar(Char::uppercaseChar) }
    is FilterNode.SubtypeIn -> node.subtypes.joinToString(", ").uppercase()
    is FilterNode.AverageRatingGte -> "${"%.1f".format(node.min)} or higher"
    is FilterNode.UserRatingGte -> "${"%.1f".format(node.min)} or higher"
    is FilterNode.WatchingStatusIn -> node.statuses.joinToString(", ")
    is FilterNode.LibraryUpdatedAfter -> formatEpochDate(node.epochMillis)
    is FilterNode.LibraryUpdatedWithin -> "Within ${node.durationMillis / (24L * 60L * 60L * 1000L)} days"
    is FilterNode.ThemeTypeIn -> node.types.joinToString(", ")
    is FilterNode.ArtistIn -> node.artistNames.joinToString(", ")
    is FilterNode.Liked -> "Only liked tracks"
    is FilterNode.Disliked -> "Only disliked tracks"
    is FilterNode.Downloaded -> "Only downloaded tracks"
    is FilterNode.PlayCountGte -> "${node.min}+ plays"
    is FilterNode.PlayedSince -> formatEpochDate(node.epochMillis)
    else -> ""
}

private fun attributeAccent(node: FilterNode): Color = when (node) {
    is FilterNode.GenreIn, is FilterNode.WatchingStatusIn, is FilterNode.Liked, is FilterNode.Disliked -> Rose500
    is FilterNode.AiredBefore, is FilterNode.AiredAfter, is FilterNode.AiredBetween,
    is FilterNode.LibraryUpdatedAfter, is FilterNode.LibraryUpdatedWithin, is FilterNode.PlayedSince -> Sky500
    is FilterNode.AverageRatingGte, is FilterNode.UserRatingGte, is FilterNode.PlayCountGte -> Gold400
    else -> Mist200
}

private fun formatEpochDate(epochMillis: Long): String {
    return Instant.ofEpochMilli(epochMillis)
        .atZone(ZoneId.systemDefault())
        .toLocalDate()
        .toString()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttributeTypePickerSheet(
    onDismiss: () -> Unit,
    onTypeChosen: (FilterNode) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    data class Option(val title: String, val subtitle: String, val prototype: FilterNode, val tint: Color)

    val options = listOf(
        Option("Genre", "Match one or more Kitsu categories", FilterNode.GenreIn(emptyList()), Rose500),
        Option("Season", "Spring, summer, fall, winter", FilterNode.SeasonIn(emptyList()), Rose500),
        Option("Media Type", "TV, movie, OVA, ONA, special", FilterNode.SubtypeIn(emptyList()), Mist200),
        Option("Watching Status", "Current or completed", FilterNode.WatchingStatusIn(emptyList()), Rose500),
        Option("Theme Type", "Opening or ending", FilterNode.ThemeTypeIn(emptyList()), Mist200),
        Option("Average Rating", "Kitsu community score", FilterNode.AverageRatingGte(7.0), Gold400),
        Option("My Rating", "Your Kitsu score", FilterNode.UserRatingGte(7.0), Gold400),
        Option("Aired Before", "Released before a year", FilterNode.AiredBefore(2000), Sky500),
        Option("Aired Between", "Released within a year range", FilterNode.AiredBetween(2000, 2010), Sky500),
        Option("Watched After", "Updated in your library after a date", FilterNode.LibraryUpdatedAfter(System.currentTimeMillis()), Sky500),
        Option("Watched Within", "Updated in your library within a time window", FilterNode.LibraryUpdatedWithin(30L * 24L * 60L * 60L * 1000L), Sky500),
        Option("Artist", "Match artist names", FilterNode.ArtistIn(emptyList()), Mist200),
        Option("Downloaded", "Only locally saved tracks", FilterNode.Downloaded(), Mist200),
        Option("Liked", "Only liked tracks", FilterNode.Liked(), Rose500),
        Option("Disliked", "Only disliked tracks", FilterNode.Disliked(), Rose500),
        Option("Play Count", "Minimum number of plays", FilterNode.PlayCountGte(5), Gold400),
        Option("Played Since", "Last played after a date", FilterNode.PlayedSince(System.currentTimeMillis()), Sky500)
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink800
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 12.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Add an attribute",
                color = Mist100,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Pick the attribute first, then set its value in the next step.",
                color = Mist200,
                fontSize = 13.sp
            )
            options.chunked(2).forEach { row ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    row.forEach { option ->
                        Surface(
                            modifier = Modifier
                                .weight(1f)
                                .clickable { onTypeChosen(option.prototype) },
                            color = Color(0xFF202028),
                            shape = RoundedCornerShape(18.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, option.tint.copy(alpha = 0.26f))
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(option.title, color = Mist100, fontWeight = FontWeight.SemiBold)
                                Text(option.subtitle, color = Mist200, fontSize = 12.sp, lineHeight = 16.sp)
                            }
                        }
                    }
                    if (row.size == 1) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun GroupTypePickerSheet(
    onDismiss: () -> Unit,
    onTypeChosen: (Boolean) -> Unit
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
                .padding(horizontal = 20.dp, vertical = 12.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Add a group",
                color = Mist100,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            GroupChoiceCard(
                label = "AND Group",
                description = "All filters inside this group must match.",
                tint = Rose500,
                onClick = { onTypeChosen(true) }
            )
            GroupChoiceCard(
                label = "OR Group",
                description = "Any filter inside this group can match.",
                tint = Gold400,
                onClick = { onTypeChosen(false) }
            )
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun GroupChoiceCard(
    label: String,
    description: String,
    tint: Color,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Color(0xFF202028),
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, tint.copy(alpha = 0.28f))
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(label, color = Mist100, fontWeight = FontWeight.SemiBold)
            Text(description, color = Mist200, fontSize = 13.sp, lineHeight = 18.sp)
        }
    }
}

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
                    GenreEditor(node, availableGenres, onConfirm)
                is FilterNode.AiredBefore ->
                    SingleYearEditor("Aired before", node.year) {
                        onConfirm(FilterNode.AiredBefore(it))
                    }
                is FilterNode.AiredAfter ->
                    SingleYearEditor("Aired after", node.year) {
                        onConfirm(FilterNode.AiredAfter(it))
                    }
                is FilterNode.AiredBetween ->
                    YearRangeEditor(node.minYear, node.maxYear) { min, max ->
                        onConfirm(FilterNode.AiredBetween(min, max))
                    }
                is FilterNode.SeasonIn ->
                    SeasonEditor(node) { onConfirm(FilterNode.SeasonIn(it)) }
                is FilterNode.SubtypeIn ->
                    SubtypeEditor(node) { onConfirm(FilterNode.SubtypeIn(it)) }
                is FilterNode.AverageRatingGte ->
                    RatingEditor("Average rating", node.min) { onConfirm(FilterNode.AverageRatingGte(it)) }
                is FilterNode.UserRatingGte ->
                    RatingEditor("My rating", node.min) { onConfirm(FilterNode.UserRatingGte(it)) }
                is FilterNode.WatchingStatusIn ->
                    WatchingStatusEditor(node) { onConfirm(FilterNode.WatchingStatusIn(it)) }
                is FilterNode.LibraryUpdatedAfter ->
                    ExactDateEditor("Watched after", node.epochMillis) { onConfirm(FilterNode.LibraryUpdatedAfter(it)) }
                is FilterNode.LibraryUpdatedWithin ->
                    DaysEditor("Watched within", node.durationMillis / DAY_MS) {
                        onConfirm(FilterNode.LibraryUpdatedWithin(it * DAY_MS))
                    }
                is FilterNode.ThemeTypeIn ->
                    ThemeTypeEditor(node) { onConfirm(FilterNode.ThemeTypeIn(it)) }
                is FilterNode.ArtistIn ->
                    ArtistEditor(node) { onConfirm(FilterNode.ArtistIn(it)) }
                is FilterNode.PlayCountGte ->
                    IntegerEditor("Played at least", node.min) { onConfirm(FilterNode.PlayCountGte(it)) }
                is FilterNode.PlayedSince ->
                    ExactDateEditor("Played since", node.epochMillis) { onConfirm(FilterNode.PlayedSince(it)) }
                is FilterNode.Liked, is FilterNode.Disliked, is FilterNode.Downloaded ->
                    NoConfigEditor(node) { onConfirm(node) }
                else ->
                    NoConfigEditor(node) { onConfirm(node) }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenreEditor(
    node: FilterNode.GenreIn,
    genres: List<com.takeya.animeongaku.data.local.GenreEntity>,
    onConfirm: (FilterNode) -> Unit
) {
    var selected by remember { mutableStateOf(node.slugs.toSet()) }
    var matchAll by remember { mutableStateOf(node.matchAll) }

    EditorTitle("Genres")
    GenreSelectionContent(
        genres = genres,
        selectedSlugs = selected,
        onToggleGenre = { slug ->
            selected = if (slug in selected) selected - slug else selected + slug
        }
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(false to "Match ANY", true to "Match ALL").forEach { (all, label) ->
            val selectedState = matchAll == all
            FilterChip(
                selected = selectedState,
                onClick = { matchAll = all },
                label = { Text(label, color = if (selectedState) Ink900 else Mist200) },
                colors = filterChipColors(selectedState)
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
        onConfirm(minText.toIntOrNull() ?: initialMin, maxText.toIntOrNull() ?: initialMax)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SeasonEditor(
    node: FilterNode.SeasonIn,
    onConfirm: (List<Season>) -> Unit
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
                        season.name.lowercase().replaceFirstChar(Char::uppercaseChar),
                        color = if (isSelected) Ink900 else Mist200
                    )
                },
                colors = filterChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(selected.toList()) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SubtypeEditor(
    node: FilterNode.SubtypeIn,
    onConfirm: (List<String>) -> Unit
) {
    var selected by remember { mutableStateOf(node.subtypes.toSet()) }
    EditorTitle("Media type")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SimpleSubtypeOptions.forEach { subtype ->
            val isSelected = subtype in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - subtype else selected + subtype },
                label = { Text(subtype.uppercase(), color = if (isSelected) Ink900 else Mist200) },
                colors = filterChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(selected.toList()) }
}

@Composable
private fun RatingEditor(
    title: String,
    initial: Double,
    onConfirm: (Double) -> Unit
) {
    var value by remember { mutableStateOf(initial.toFloat()) }
    EditorTitle(title)
    Text("${"%.1f".format(value)}+", color = Mist100, fontWeight = FontWeight.SemiBold)
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
    onConfirm: (List<String>) -> Unit
) {
    var selected by remember { mutableStateOf(node.statuses.toSet()) }
    EditorTitle("Watching status")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SimpleWatchingStatusOptions.forEach { (status, label) ->
            val isSelected = status in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - status else selected + status },
                label = { Text(label, color = if (isSelected) Ink900 else Mist200) },
                colors = filterChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(selected.toList()) }
}

@Composable
private fun ExactDateEditor(
    title: String,
    initialEpochMillis: Long,
    onConfirm: (Long) -> Unit
) {
    var text by remember { mutableStateOf(formatEpochDate(initialEpochMillis)) }
    EditorTitle(title)
    Text(
        text = "Use ISO format: YYYY-MM-DD",
        color = Mist200,
        fontSize = 12.sp
    )
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Date", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton {
        onConfirm(parseLocalDate(text) ?: initialEpochMillis)
    }
}

@Composable
private fun DaysEditor(
    title: String,
    initialDays: Long,
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
    onConfirm: (List<String>) -> Unit
) {
    var selected by remember { mutableStateOf(node.types.toSet()) }
    EditorTitle("Theme type")
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SimpleThemeTypeOptions.forEach { (type, label) ->
            val isSelected = type in selected
            FilterChip(
                selected = isSelected,
                onClick = { selected = if (isSelected) selected - type else selected + type },
                label = { Text(label, color = if (isSelected) Ink900 else Mist200) },
                colors = filterChipColors(isSelected)
            )
        }
    }
    ConfirmButton { onConfirm(selected.toList()) }
}

@Composable
private fun ArtistEditor(
    node: FilterNode.ArtistIn,
    onConfirm: (List<String>) -> Unit
) {
    var text by remember { mutableStateOf(node.artistNames.joinToString(", ")) }
    EditorTitle("Artists")
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        label = { Text("Comma-separated names", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton {
        onConfirm(text.split(",").map(String::trim).filter(String::isNotBlank))
    }
}

@Composable
private fun IntegerEditor(
    title: String,
    initial: Int,
    onConfirm: (Int) -> Unit
) {
    var text by remember { mutableStateOf(initial.toString()) }
    EditorTitle(title)
    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        singleLine = true,
        label = { Text("Value", color = Mist200) },
        modifier = Modifier.fillMaxWidth(),
        colors = editorTextFieldColors()
    )
    ConfirmButton { onConfirm(text.toIntOrNull() ?: initial) }
}

@Composable
private fun NoConfigEditor(
    node: FilterNode,
    onConfirm: () -> Unit
) {
    EditorTitle(attributeTitle(node))
    Text(
        text = attributeValue(node),
        color = Mist200,
        fontSize = 14.sp,
        lineHeight = 20.sp
    )
    ConfirmButton(onClick = onConfirm)
}

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
        Text("Apply", color = Color.White, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun editorTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = Rose500,
    unfocusedBorderColor = Mist200,
    focusedTextColor = Mist100,
    unfocusedTextColor = Mist100,
    cursorColor = Rose500
)

private fun parseLocalDate(text: String): Long? {
    return runCatching {
        LocalDate.parse(text)
            .atStartOfDay(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
    }.getOrNull()
}

private const val DAY_MS = 24L * 60L * 60L * 1000L
