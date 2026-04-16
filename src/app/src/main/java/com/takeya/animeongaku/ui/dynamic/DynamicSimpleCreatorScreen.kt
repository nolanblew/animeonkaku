package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DynamicSimpleCreatorScreen(
    onNavigateToPreview: () -> Unit,
    onNavigateToAdvanced: () -> Unit,
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()
    val s = state.simple

    val backgroundBrush = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))

    // Determine if the filter is "empty" (no children selected)
    val filterIsEmpty = s.timeMode == TimeMode.ANY
        && s.seasons.isEmpty()
        && s.genreSlugs.isEmpty()
        && s.minRating == null
        && s.subtypes.isEmpty()
        && s.watchingStatuses.isEmpty()
        && s.themeTypes.isEmpty()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(brush = backgroundBrush)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(bottom = 140.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Top bar
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.Rounded.ArrowBack,
                            contentDescription = "Back",
                            tint = Mist100
                        )
                    }
                    Text(
                        text = "New Smart Playlist",
                        color = Mist100,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.weight(1f).padding(start = 4.dp)
                    )
                }
            }

            // ----------------------------------------------------------------
            // Section 1: Time period
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Time period") {
                    // Aired / Watched segmented toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        TimeDimension.entries.forEach { dim ->
                            val selected = s.timeDimension == dim
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.setTimeDimension(dim) },
                                label = {
                                    Text(
                                        if (dim == TimeDimension.AIRED) "Aired" else "Watched",
                                        color = if (selected) Ink900 else Mist200
                                    )
                                },
                                colors = filterChipColors(selected),
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Preset time chips
                    var showCustomSheet by remember { mutableStateOf(false) }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        data class TimePreset(val mode: TimeMode, val label: String)
                        listOf(
                            TimePreset(TimeMode.ANY, "Any time"),
                            TimePreset(TimeMode.LAST_6_MONTHS, "Last 6 months"),
                            TimePreset(TimeMode.LAST_2_YEARS, "Last 2 years"),
                            TimePreset(TimeMode.BEFORE_2000, "Before 2000"),
                            TimePreset(TimeMode.Y2000_2010, "2000-2010"),
                            TimePreset(TimeMode.Y2010_2020, "2010-2020")
                        ).forEach { preset ->
                            val selected = s.timeMode == preset.mode
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.setTimeMode(preset.mode) },
                                label = { Text(preset.label, color = if (selected) Ink900 else Mist200) },
                                colors = filterChipColors(selected)
                            )
                        }
                        // Custom chip
                        val customSelected = s.timeMode == TimeMode.CUSTOM
                        FilterChip(
                            selected = customSelected,
                            onClick = {
                                viewModel.setTimeMode(TimeMode.CUSTOM)
                                showCustomSheet = true
                            },
                            label = { Text("Custom...", color = if (customSelected) Ink900 else Mist200) },
                            colors = filterChipColors(customSelected)
                        )
                    }

                    if (showCustomSheet) {
                        CustomRangeBottomSheet(
                            timeDimension = s.timeDimension,
                            currentRange = s.customRange,
                            onDismiss = { showCustomSheet = false },
                            onConfirm = { range ->
                                viewModel.setCustomRange(range)
                                showCustomSheet = false
                            }
                        )
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 2: Season
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Season") {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Season.entries.forEach { season ->
                            val selected = season in s.seasons
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.toggleSeason(season) },
                                label = {
                                    Text(
                                        season.name.lowercase()
                                            .replaceFirstChar { it.uppercaseChar() },
                                        color = if (selected) Ink900 else Mist200
                                    )
                                },
                                colors = filterChipColors(selected)
                            )
                        }
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 3: Genres
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Genres") {
                    if (state.availableGenres.isNotEmpty()) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            state.availableGenres.forEach { genre ->
                                val selected = genre.slug in s.genreSlugs
                                FilterChip(
                                    selected = selected,
                                    onClick = { viewModel.toggleGenreSlug(genre.slug) },
                                    label = {
                                        Text(
                                            genre.displayName,
                                            color = if (selected) Ink900 else Mist200
                                        )
                                    },
                                    colors = filterChipColors(selected)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        // Match ANY / ALL toggle
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf(false to "Match ANY", true to "Match ALL").forEach { (matchAll, label) ->
                                val selected = s.genreMatchAll == matchAll
                                FilterChip(
                                    selected = selected,
                                    onClick = { viewModel.setGenreMatchAll(matchAll) },
                                    label = { Text(label, color = if (selected) Ink900 else Mist200) },
                                    colors = filterChipColors(selected)
                                )
                            }
                        }
                    } else {
                        Text("No genres available", color = Mist200, fontSize = 14.sp)
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 4: Minimum rating
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Minimum rating") {
                    val ratingLabel = s.minRating?.let { "${"%.1f".format(it)}+" } ?: "No minimum"
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(ratingLabel, color = Mist100, fontWeight = FontWeight.SemiBold)
                        TextButton(onClick = { viewModel.setMinRating(null) }) {
                            Text("Clear", color = Rose500)
                        }
                    }
                    Slider(
                        value = s.minRating?.toFloat() ?: 0f,
                        onValueChange = { v ->
                            viewModel.setMinRating(if (v <= 0f) null else v.toDouble())
                        },
                        valueRange = 0f..10f,
                        steps = 19,
                        modifier = Modifier.fillMaxWidth(),
                        colors = SliderDefaults.colors(
                            thumbColor = Rose500,
                            activeTrackColor = Rose500,
                            inactiveTrackColor = Ink700
                        )
                    )
                    // Mine / Average toggle
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(
                            RatingSource.MINE to "Mine",
                            RatingSource.AVERAGE to "Average"
                        ).forEach { (src, label) ->
                            val selected = s.ratingSource == src
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.setRatingSource(src) },
                                label = { Text(label, color = if (selected) Ink900 else Mist200) },
                                colors = filterChipColors(selected)
                            )
                        }
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 5: Media type
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Media type") {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("tv", "movie", "ova", "ona", "special").forEach { subtype ->
                            val selected = subtype in s.subtypes
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.toggleSubtype(subtype) },
                                label = {
                                    Text(
                                        subtype.uppercase(),
                                        color = if (selected) Ink900 else Mist200
                                    )
                                },
                                colors = filterChipColors(selected)
                            )
                        }
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 6: Watching status
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Watching status") {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf(
                            "current" to "Current",
                            "completed" to "Completed",
                            "on_hold" to "On Hold",
                            "dropped" to "Dropped",
                            "planned" to "Plan to Watch"
                        ).forEach { (status, label) ->
                            val selected = status in s.watchingStatuses
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.toggleWatchingStatus(status) },
                                label = { Text(label, color = if (selected) Ink900 else Mist200) },
                                colors = filterChipColors(selected)
                            )
                        }
                    }
                }
            }

            // ----------------------------------------------------------------
            // Section 7: Theme type
            // ----------------------------------------------------------------
            item {
                SectionCard(title = "Theme type") {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("OP" to "Opening", "ED" to "Ending", "IN" to "Insert").forEach { (type, label) ->
                            val selected = type in s.themeTypes
                            FilterChip(
                                selected = selected,
                                onClick = { viewModel.toggleThemeType(type) },
                                label = { Text(label, color = if (selected) Ink900 else Mist200) },
                                colors = filterChipColors(selected)
                            )
                        }
                    }
                }
            }

            item { Spacer(modifier = Modifier.height(8.dp)) }
        }

        // ----------------------------------------------------------------
        // Bottom sticky bar
        // ----------------------------------------------------------------
        Card(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding(),
            colors = CardDefaults.cardColors(containerColor = Ink800),
            shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
            elevation = CardDefaults.cardElevation(defaultElevation = 8.dp)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "${preview.count} tracks match",
                    color = Mist200,
                    fontSize = 14.sp
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(
                        onClick = {
                            viewModel.promoteToAdvanced()
                            onNavigateToAdvanced()
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AutoAwesome,
                            contentDescription = null,
                            tint = Rose500
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Advanced Builder", color = Rose500)
                    }
                    Button(
                        onClick = onNavigateToPreview,
                        enabled = !filterIsEmpty,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Rose500,
                            disabledContainerColor = Ink700
                        )
                    ) {
                        Text(
                            "Save Playlist",
                            color = if (filterIsEmpty) Mist200 else Color.White,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Section card helper
// ---------------------------------------------------------------------------

@Composable
private fun SectionCard(
    title: String,
    content: @Composable () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFF181820)),
        shape = RoundedCornerShape(16.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = title,
                color = Mist100,
                fontWeight = FontWeight.SemiBold,
                fontSize = 16.sp
            )
            content()
        }
    }
}

// ---------------------------------------------------------------------------
// FilterChip colors helper
// ---------------------------------------------------------------------------

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun filterChipColors(selected: Boolean) = FilterChipDefaults.filterChipColors(
    selectedContainerColor = Rose500,
    selectedLabelColor = Color.White,
    containerColor = Color(0xFF252530),
    labelColor = Mist200
)

// ---------------------------------------------------------------------------
// Custom Range Bottom Sheet
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun CustomRangeBottomSheet(
    timeDimension: TimeDimension,
    currentRange: CustomRange?,
    onDismiss: () -> Unit,
    onConfirm: (CustomRange) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    // Relative tab state
    var rangeType by remember { mutableStateOf(if (currentRange is CustomRange.Relative) "RELATIVE" else "EXACT") }

    // Relative: duration in days
    var relativeDays by remember {
        mutableStateOf(
            (currentRange as? CustomRange.Relative)?.let { it.durationMillis / (24 * 60 * 60 * 1000L) }?.toFloat() ?: 90f
        )
    }

    // Exact: year range
    var startYear by remember {
        mutableStateOf(
            (currentRange as? CustomRange.Exact)?.startYear?.toString() ?: "2015"
        )
    }
    var endYear by remember {
        mutableStateOf(
            (currentRange as? CustomRange.Exact)?.endYear?.toString() ?: "2020"
        )
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = Ink800
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                "Custom time range",
                color = Mist100,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )

            // Range type toggle (show for WATCHED → Relative makes sense; AIRED → Exact)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("RELATIVE" to "Relative", "EXACT" to "Exact dates").forEach { (type, label) ->
                    val selected = rangeType == type
                    FilterChip(
                        selected = selected,
                        onClick = { rangeType = type },
                        label = { Text(label, color = if (selected) Ink900 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }

            if (rangeType == "RELATIVE") {
                // Relative: slider for days
                val days = relativeDays.toInt()
                Text(
                    "Last $days days",
                    color = Mist100,
                    fontWeight = FontWeight.SemiBold
                )
                Slider(
                    value = relativeDays,
                    onValueChange = { relativeDays = it },
                    valueRange = 7f..730f,
                    modifier = Modifier.fillMaxWidth(),
                    colors = SliderDefaults.colors(
                        thumbColor = Rose500,
                        activeTrackColor = Rose500,
                        inactiveTrackColor = Ink700
                    )
                )
            } else {
                // Exact date range
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = startYear,
                        onValueChange = { startYear = it },
                        label = { Text("From year", color = Mist200) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Rose500,
                            unfocusedBorderColor = Mist200,
                            focusedTextColor = Mist100,
                            unfocusedTextColor = Mist100
                        )
                    )
                    OutlinedTextField(
                        value = endYear,
                        onValueChange = { endYear = it },
                        label = { Text("To year", color = Mist200) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Rose500,
                            unfocusedBorderColor = Mist200,
                            focusedTextColor = Mist100,
                            unfocusedTextColor = Mist100
                        )
                    )
                }
            }

            Button(
                onClick = {
                    val range = if (rangeType == "RELATIVE") {
                        CustomRange.Relative(
                            durationMillis = relativeDays.toLong() * 24 * 60 * 60 * 1000L
                        )
                    } else {
                        CustomRange.Exact(
                            startYear = startYear.toIntOrNull() ?: 2015,
                            endYear = endYear.toIntOrNull() ?: 2020
                        )
                    }
                    onConfirm(range)
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Rose500)
            ) {
                Text("Apply", color = Color.White, fontWeight = FontWeight.SemiBold)
            }

            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}
