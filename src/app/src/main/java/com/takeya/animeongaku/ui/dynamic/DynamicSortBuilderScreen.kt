@file:OptIn(ExperimentalMaterial3Api::class)

package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ArrowDownward
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SwapVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.ModalBottomSheet
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
import com.takeya.animeongaku.data.filter.SortAttribute
import com.takeya.animeongaku.data.filter.SortDirection
import com.takeya.animeongaku.data.filter.SortKey
import com.takeya.animeongaku.data.filter.SortSpec
import com.takeya.animeongaku.data.filter.SortValueKind
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.theme.Gold400
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import com.takeya.animeongaku.ui.theme.Sky500

@Composable
fun DynamicSortBuilderScreen(
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()

    val sort = state.sort
    val scrollState = rememberScrollState()

    var pickerTarget by remember { mutableStateOf<SortPickerTarget?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Ink900, Ink800, Ink700)))
    ) {
        SortCanvasBackdrop()

        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
        ) {
            SortTopBar(onBack = onBack)
            Text(
                text = "Sort by up to ${SortSpec.MAX_KEYS} attributes. Earlier keys win ties.",
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
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (sort.keys.isEmpty()) {
                    EmptySortCard(onAdd = { pickerTarget = SortPickerTarget.Add })
                } else {
                    sort.keys.forEachIndexed { index, key ->
                        SortKeyCard(
                            priority = index + 1,
                            key = key,
                            isFirst = index == 0,
                            isLast = index == sort.keys.lastIndex,
                            onChangeDirection = { dir ->
                                viewModel.setSortDirection(index, dir)
                            },
                            onChangeAttribute = {
                                pickerTarget = SortPickerTarget.Replace(index)
                            },
                            onMoveUp = { viewModel.moveSortKey(index, index - 1) },
                            onMoveDown = { viewModel.moveSortKey(index, index + 1) },
                            onRemove = { viewModel.removeSortKey(index) }
                        )
                    }
                }

                if (sort.keys.size < SortSpec.MAX_KEYS) {
                    AddKeyChip(onClick = { pickerTarget = SortPickerTarget.Add })
                } else {
                    Text(
                        text = "Maximum of ${SortSpec.MAX_KEYS} sort keys reached.",
                        color = Mist200,
                        fontSize = 12.sp
                    )
                }

                TextButton(
                    onClick = { viewModel.resetSortToDefault() },
                    modifier = Modifier.padding(top = 4.dp)
                ) {
                    Icon(
                        Icons.Rounded.Refresh,
                        contentDescription = null,
                        tint = Mist200,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Reset to default", color = Mist200)
                }
            }
        }

        SortResultsBar(
            count = preview.count,
            onDone = onBack,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(bottom = MiniPlayerHeight)
                .navigationBarsPadding()
        )
    }

    pickerTarget?.let { target ->
        val currentAttribute = when (target) {
            is SortPickerTarget.Replace -> sort.keys.getOrNull(target.index)?.attribute
            SortPickerTarget.Add -> null
        }
        val takenAttributes = sort.keys
            .mapIndexedNotNull { i, k ->
                if (target is SortPickerTarget.Replace && i == target.index) null else k.attribute
            }
            .toSet()
        SortAttributePickerSheet(
            currentAttribute = currentAttribute,
            takenAttributes = takenAttributes,
            onDismiss = { pickerTarget = null },
            onAttributeChosen = { attribute ->
                when (target) {
                    SortPickerTarget.Add -> viewModel.addSortKey(attribute)
                    is SortPickerTarget.Replace -> viewModel.setSortAttribute(target.index, attribute)
                }
                pickerTarget = null
            }
        )
    }
}

private sealed interface SortPickerTarget {
    data object Add : SortPickerTarget
    data class Replace(val index: Int) : SortPickerTarget
}

@Composable
private fun SortCanvasBackdrop() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    colors = listOf(Sky500.copy(alpha = 0.10f), Color.Transparent),
                    radius = 900f
                )
            )
    )
}

@Composable
private fun SortTopBar(onBack: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 8.dp)
    ) {
        IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(Icons.Rounded.ArrowBack, contentDescription = "Back", tint = Mist100)
        }
        Text(
            text = "Sort Order",
            color = Mist100,
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Center)
        )
    }
}

@Composable
private fun SortResultsBar(
    count: Int,
    onDone: () -> Unit,
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
                    text = "PREVIEW",
                    color = Mist200,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "Reordering $count matching tracks",
                    color = Mist100,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    lineHeight = 24.sp
                )
            }
            Button(
                onClick = onDone,
                shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF181820),
                    contentColor = Sky500
                )
            ) {
                Text("Done", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun SortKeyCard(
    priority: Int,
    key: SortKey,
    isFirst: Boolean,
    isLast: Boolean,
    onChangeDirection: (SortDirection) -> Unit,
    onChangeAttribute: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit
) {
    val accent = attributeAccent(key.attribute)
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A20)),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.28f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                PriorityBadge(priority = priority, accent = accent)
                Spacer(modifier = Modifier.width(12.dp))
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .clickable(onClick = onChangeAttribute)
                ) {
                    Text(
                        text = "SORT KEY",
                        color = Mist200,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = attributeLabel(key.attribute),
                        color = Mist100,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = attributeKindLabel(key.attribute),
                        color = Mist200,
                        fontSize = 12.sp
                    )
                }
                SortKeyMenu(
                    isFirst = isFirst,
                    isLast = isLast,
                    onChangeAttribute = onChangeAttribute,
                    onMoveUp = onMoveUp,
                    onMoveDown = onMoveDown,
                    onRemove = onRemove
                )
            }

            DirectionRow(
                attribute = key.attribute,
                direction = key.direction,
                accent = accent,
                onChangeDirection = onChangeDirection
            )
        }
    }
}

@Composable
private fun PriorityBadge(priority: Int, accent: Color) {
    Box(
        modifier = Modifier
            .size(32.dp)
            .background(accent.copy(alpha = 0.18f), CircleShape)
            .border(1.dp, accent.copy(alpha = 0.5f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = priority.toString(),
            color = accent,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun SortKeyMenu(
    isFirst: Boolean,
    isLast: Boolean,
    onChangeAttribute: () -> Unit,
    onMoveUp: () -> Unit,
    onMoveDown: () -> Unit,
    onRemove: () -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Rounded.MoreVert, contentDescription = "Key actions", tint = Mist200)
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            containerColor = Ink800
        ) {
            DropdownMenuItem(
                text = { Text("Change attribute…", color = Mist100) },
                leadingIcon = {
                    Icon(Icons.Rounded.SwapVert, contentDescription = null, tint = Mist200)
                },
                onClick = {
                    expanded = false
                    onChangeAttribute()
                },
                colors = MenuDefaults.itemColors()
            )
            if (!isFirst) {
                DropdownMenuItem(
                    text = { Text("Move up", color = Mist100) },
                    leadingIcon = {
                        Icon(Icons.Rounded.ArrowUpward, contentDescription = null, tint = Mist200)
                    },
                    onClick = {
                        expanded = false
                        onMoveUp()
                    },
                    colors = MenuDefaults.itemColors()
                )
            }
            if (!isLast) {
                DropdownMenuItem(
                    text = { Text("Move down", color = Mist100) },
                    leadingIcon = {
                        Icon(Icons.Rounded.ArrowDownward, contentDescription = null, tint = Mist200)
                    },
                    onClick = {
                        expanded = false
                        onMoveDown()
                    },
                    colors = MenuDefaults.itemColors()
                )
            }
            DropdownMenuItem(
                text = { Text("Remove", color = Rose500) },
                leadingIcon = {
                    Icon(Icons.Rounded.Delete, contentDescription = null, tint = Rose500)
                },
                onClick = {
                    expanded = false
                    onRemove()
                },
                colors = MenuDefaults.itemColors()
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DirectionRow(
    attribute: SortAttribute,
    direction: SortDirection,
    accent: Color,
    onChangeDirection: (SortDirection) -> Unit
) {
    if (attribute.valueKind == SortValueKind.RANDOM) {
        Surface(
            color = accent.copy(alpha = 0.12f),
            shape = RoundedCornerShape(999.dp),
            border = BorderStroke(1.dp, accent.copy(alpha = 0.28f))
        ) {
            Text(
                text = "Shuffle",
                color = accent,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
            )
        }
        return
    }
    val (ascLabel, descLabel) = directionLabels(attribute)
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        DirectionChip(
            label = ascLabel,
            selected = direction == SortDirection.ASC,
            accent = accent,
            onClick = { onChangeDirection(SortDirection.ASC) }
        )
        DirectionChip(
            label = descLabel,
            selected = direction == SortDirection.DESC,
            accent = accent,
            onClick = { onChangeDirection(SortDirection.DESC) }
        )
    }
}

@Composable
private fun DirectionChip(
    label: String,
    selected: Boolean,
    accent: Color,
    onClick: () -> Unit
) {
    val bg = if (selected) accent.copy(alpha = 0.22f) else Color(0xFF202028)
    val border = if (selected) accent.copy(alpha = 0.7f) else accent.copy(alpha = 0.24f)
    val fg = if (selected) accent else Mist200
    Surface(
        modifier = Modifier.clickable(onClick = onClick),
        color = bg,
        shape = RoundedCornerShape(999.dp),
        border = BorderStroke(1.dp, border)
    ) {
        Text(
            text = label,
            color = fg,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
        )
    }
}

@Composable
private fun AddKeyChip(onClick: () -> Unit) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        color = Sky500.copy(alpha = 0.08f),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Sky500.copy(alpha = 0.35f))
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Rounded.Add, contentDescription = null, tint = Sky500)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Add sort key", color = Sky500, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun EmptySortCard(onAdd: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1A1A20)),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Mist200.copy(alpha = 0.24f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "No sort keys",
                color = Mist100,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp
            )
            Text(
                text = "Without a sort key, tracks fall back to title order.",
                color = Mist200,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )
            Button(
                onClick = onAdd,
                colors = ButtonDefaults.buttonColors(containerColor = Sky500)
            ) {
                Text("Add sort key")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SortAttributePickerSheet(
    currentAttribute: SortAttribute?,
    takenAttributes: Set<SortAttribute>,
    onDismiss: () -> Unit,
    onAttributeChosen: (SortAttribute) -> Unit
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
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = if (currentAttribute == null) "Add sort key" else "Change attribute",
                color = Mist100,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Pick the attribute to sort by. Attributes already in the list are dimmed.",
                color = Mist200,
                fontSize = 13.sp
            )
            AttributeCategory.values().forEach { category ->
                val items = category.attributes
                Text(
                    text = category.displayName.uppercase(),
                    color = Mist200,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items.forEach { attr ->
                        val taken = attr in takenAttributes && attr != currentAttribute
                        AttributePickerChip(
                            label = attributeLabel(attr),
                            subtitle = attributeKindLabel(attr),
                            accent = attributeAccent(attr),
                            selected = attr == currentAttribute,
                            dimmed = taken,
                            onClick = {
                                if (!taken) onAttributeChosen(attr)
                            }
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Composable
private fun AttributePickerChip(
    label: String,
    subtitle: String,
    accent: Color,
    selected: Boolean,
    dimmed: Boolean,
    onClick: () -> Unit
) {
    val borderAlpha = when {
        selected -> 0.7f
        dimmed -> 0.1f
        else -> 0.28f
    }
    val bg = if (selected) accent.copy(alpha = 0.18f) else Color(0xFF202028)
    val fg = when {
        dimmed -> Mist200.copy(alpha = 0.5f)
        selected -> accent
        else -> Mist100
    }
    Surface(
        modifier = Modifier.clickable(enabled = !dimmed, onClick = onClick),
        color = bg,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, accent.copy(alpha = borderAlpha))
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(label, color = fg, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text(
                subtitle,
                color = fg.copy(alpha = 0.7f),
                fontSize = 11.sp
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Attribute metadata (labels, categories, accents)
// ---------------------------------------------------------------------------

private enum class AttributeCategory(
    val displayName: String,
    val attributes: List<SortAttribute>
) {
    SONG("Song", listOf(SortAttribute.TITLE, SortAttribute.ARTIST, SortAttribute.THEME_TYPE)),
    ANIME("Anime", listOf(
        SortAttribute.ANIME_TITLE,
        SortAttribute.AIRED_DATE,
        SortAttribute.AVERAGE_RATING,
        SortAttribute.MY_RATING
    )),
    LIBRARY("Library", listOf(SortAttribute.WATCHED_DATE, SortAttribute.LIKED, SortAttribute.DOWNLOADED)),
    PLAYBACK("Playback", listOf(SortAttribute.PLAY_COUNT, SortAttribute.LAST_PLAYED)),
    MISC("Misc", listOf(SortAttribute.RANDOM))
}

internal fun attributeLabel(attr: SortAttribute): String = when (attr) {
    SortAttribute.TITLE -> "Title"
    SortAttribute.ARTIST -> "Artist"
    SortAttribute.ANIME_TITLE -> "Anime Title"
    SortAttribute.THEME_TYPE -> "Theme Type"
    SortAttribute.AIRED_DATE -> "Aired Date"
    SortAttribute.WATCHED_DATE -> "Watched Date"
    SortAttribute.AVERAGE_RATING -> "Average Rating"
    SortAttribute.MY_RATING -> "My Rating"
    SortAttribute.PLAY_COUNT -> "Play Count"
    SortAttribute.LAST_PLAYED -> "Last Played"
    SortAttribute.LIKED -> "Liked"
    SortAttribute.DOWNLOADED -> "Downloaded"
    SortAttribute.RANDOM -> "Random"
}

internal fun attributeKindLabel(attr: SortAttribute): String = when (attr.valueKind) {
    SortValueKind.STRING -> "Text"
    SortValueKind.NUMBER -> "Number"
    SortValueKind.DATE -> "Date"
    SortValueKind.BOOLEAN -> "Yes / No"
    SortValueKind.THEME_TYPE -> "OP / IN / ED order"
    SortValueKind.RANDOM -> "Shuffle"
}

/** Returns (ascendingLabel, descendingLabel) for an attribute's value kind. */
internal fun directionLabels(attr: SortAttribute): Pair<String, String> = when (attr.valueKind) {
    SortValueKind.STRING, SortValueKind.THEME_TYPE -> "A \u2192 Z" to "Z \u2192 A"
    SortValueKind.NUMBER -> "Low \u2192 High" to "High \u2192 Low"
    SortValueKind.DATE -> "Oldest first" to "Newest first"
    SortValueKind.BOOLEAN -> "Yes first" to "No first"
    SortValueKind.RANDOM -> "Shuffle" to "Shuffle"
}

internal fun attributeAccent(attr: SortAttribute): Color = when (attr.valueKind) {
    SortValueKind.STRING -> Rose500
    SortValueKind.NUMBER -> Gold400
    SortValueKind.DATE -> Sky500
    SortValueKind.BOOLEAN -> Rose500
    SortValueKind.THEME_TYPE -> Mist200
    SortValueKind.RANDOM -> Gold400
}

