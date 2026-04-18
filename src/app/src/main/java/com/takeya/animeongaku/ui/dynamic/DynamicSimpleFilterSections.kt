package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.takeya.animeongaku.data.filter.CustomRange
import com.takeya.animeongaku.data.filter.RatingSource
import com.takeya.animeongaku.data.filter.Season
import com.takeya.animeongaku.data.filter.SimpleSectionsState
import com.takeya.animeongaku.data.filter.TimeDimension
import com.takeya.animeongaku.data.filter.TimeMode
import com.takeya.animeongaku.data.local.GenreEntity
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

internal val SimpleSubtypeOptions = listOf("tv", "movie", "ova", "ona", "special")
internal val SimpleWatchingStatusOptions = listOf(
    "current" to "Current",
    "completed" to "Completed"
)
internal val SimpleThemeTypeOptions = listOf(
    "OP" to "Opening",
    "ED" to "Ending"
)

private const val VisibleGenreCount = 7
private const val GenreSearchResultLimit = 60

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DynamicSimpleFilterSections(
    state: SimpleSectionsState,
    availableGenres: List<GenreEntity>,
    modifier: Modifier = Modifier,
    onTimeDimensionChange: (TimeDimension) -> Unit,
    onTimeModeChange: (TimeMode) -> Unit,
    onCustomRangeChange: (CustomRange?) -> Unit,
    onSeasonToggle: (Season) -> Unit,
    onGenreToggle: (String) -> Unit,
    onGenreMatchAllChange: (Boolean) -> Unit,
    onMinRatingChange: (Double?) -> Unit,
    onRatingSourceChange: (RatingSource) -> Unit,
    onSubtypeToggle: (String) -> Unit,
    onWatchingStatusToggle: (String) -> Unit,
    onThemeTypeToggle: (String) -> Unit
) {
    var showCustomSheet by remember { mutableStateOf(false) }
    var showGenreSheet by remember { mutableStateOf(false) }

    val selectedGenres = remember(state.genreSlugs, availableGenres) {
        availableGenres.filter { it.slug in state.genreSlugs }
    }
    val visibleGenres = remember(selectedGenres, availableGenres) {
        val quickGenres = availableGenres.take(VisibleGenreCount)
        (selectedGenres + quickGenres).distinctBy { it.slug }
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        SectionCard(title = "Time period") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TimeDimension.entries.forEach { dimension ->
                    val selected = state.timeDimension == dimension
                    FilterChip(
                        selected = selected,
                        onClick = { onTimeDimensionChange(dimension) },
                        label = {
                            Text(
                                if (dimension == TimeDimension.AIRED) "Aired" else "Watched",
                                color = if (selected) Ink800 else Mist200
                            )
                        },
                        colors = filterChipColors(selected),
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

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
                    val selected = state.timeMode == preset.mode
                    FilterChip(
                        selected = selected,
                        onClick = { onTimeModeChange(preset.mode) },
                        label = { Text(preset.label, color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }

                val customSelected = state.timeMode == TimeMode.CUSTOM
                FilterChip(
                    selected = customSelected,
                    onClick = {
                        onTimeModeChange(TimeMode.CUSTOM)
                        showCustomSheet = true
                    },
                    label = { Text("Custom...", color = if (customSelected) Ink800 else Mist200) },
                    colors = filterChipColors(customSelected)
                )
            }
        }

        SectionCard(title = "Season") {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Season.entries.forEach { season ->
                    val selected = season in state.seasons
                    FilterChip(
                        selected = selected,
                        onClick = { onSeasonToggle(season) },
                        label = {
                            Text(
                                season.name.lowercase().replaceFirstChar { it.uppercaseChar() },
                                color = if (selected) Ink800 else Mist200
                            )
                        },
                        colors = filterChipColors(selected)
                    )
                }
            }
        }

        SectionCard(title = "Genres") {
            if (availableGenres.isEmpty()) {
                Text(
                    text = "No genres available yet. Run a full sync to load Kitsu categories.",
                    color = Mist200,
                    fontSize = 14.sp
                )
            } else {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    visibleGenres.forEach { genre ->
                        val selected = genre.slug in state.genreSlugs
                        FilterChip(
                            selected = selected,
                            onClick = { onGenreToggle(genre.slug) },
                            label = {
                                Text(
                                    genre.displayName,
                                    color = if (selected) Ink800 else Mist200
                                )
                            },
                            colors = filterChipColors(selected)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                TextButton(
                    onClick = { showGenreSheet = true },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = if (state.genreSlugs.isEmpty()) {
                            "Browse all ${availableGenres.size} genres"
                        } else {
                            "Browse genres (${state.genreSlugs.size} selected)"
                        },
                        color = Rose500
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(false to "Match ANY", true to "Match ALL").forEach { (matchAll, label) ->
                        val selected = state.genreMatchAll == matchAll
                        FilterChip(
                            selected = selected,
                            onClick = { onGenreMatchAllChange(matchAll) },
                            label = { Text(label, color = if (selected) Ink800 else Mist200) },
                            colors = filterChipColors(selected)
                        )
                    }
                }
            }
        }

        SectionCard(title = "Minimum rating") {
            val ratingLabel = state.minRating?.let { "${"%.1f".format(it)}+" } ?: "No minimum"
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(ratingLabel, color = Mist100, fontWeight = FontWeight.SemiBold)
                TextButton(onClick = { onMinRatingChange(null) }) {
                    Text("Clear", color = Rose500)
                }
            }
            Slider(
                value = state.minRating?.toFloat() ?: 0f,
                onValueChange = { value ->
                    onMinRatingChange(if (value <= 0f) null else value.toDouble())
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

            Spacer(modifier = Modifier.height(4.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(
                    RatingSource.MINE to "Mine",
                    RatingSource.AVERAGE to "Average"
                ).forEach { (source, label) ->
                    val selected = state.ratingSource == source
                    FilterChip(
                        selected = selected,
                        onClick = { onRatingSourceChange(source) },
                        label = { Text(label, color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }
        }

        SectionCard(title = "Media type") {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SimpleSubtypeOptions.forEach { subtype ->
                    val selected = subtype in state.subtypes
                    FilterChip(
                        selected = selected,
                        onClick = { onSubtypeToggle(subtype) },
                        label = { Text(subtype.uppercase(), color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }
        }

        SectionCard(title = "Watching status") {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SimpleWatchingStatusOptions.forEach { (status, label) ->
                    val selected = status in state.watchingStatuses
                    FilterChip(
                        selected = selected,
                        onClick = { onWatchingStatusToggle(status) },
                        label = { Text(label, color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }
        }

        SectionCard(title = "Theme type") {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SimpleThemeTypeOptions.forEach { (type, label) ->
                    val selected = type in state.themeTypes
                    FilterChip(
                        selected = selected,
                        onClick = { onThemeTypeToggle(type) },
                        label = { Text(label, color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }
        }
    }

    if (showCustomSheet) {
        CustomRangeBottomSheet(
            timeDimension = state.timeDimension,
            currentRange = state.customRange,
            onDismiss = { showCustomSheet = false },
            onConfirm = { range ->
                onCustomRangeChange(range)
                showCustomSheet = false
            }
        )
    }

    if (showGenreSheet) {
        GenrePickerSheet(
            genres = availableGenres,
            selectedSlugs = state.genreSlugs,
            onDismiss = { showGenreSheet = false },
            onToggleGenre = onGenreToggle
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GenreSelectionContent(
    genres: List<GenreEntity>,
    selectedSlugs: Set<String>,
    onToggleGenre: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var query by remember { mutableStateOf("") }
    val trimmedQuery = query.trim()
    val filteredGenres = remember(genres, trimmedQuery) {
        val baseList = if (trimmedQuery.isEmpty()) {
            genres
        } else {
            genres.filter {
                it.displayName.contains(trimmedQuery, ignoreCase = true) ||
                    it.slug.contains(trimmedQuery, ignoreCase = true)
            }
        }
        baseList.take(GenreSearchResultLimit)
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search genres", color = Mist200) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Rose500,
                unfocusedBorderColor = Mist200,
                focusedTextColor = Mist100,
                unfocusedTextColor = Mist100,
                cursorColor = Rose500
            )
        )

        if (selectedSlugs.isNotEmpty()) {
            Text(
                text = "Selected",
                color = Mist100,
                fontWeight = FontWeight.SemiBold
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                genres.filter { it.slug in selectedSlugs }.forEach { genre ->
                    FilterChip(
                        selected = true,
                        onClick = { onToggleGenre(genre.slug) },
                        label = { Text(genre.displayName, color = Ink800) },
                        colors = filterChipColors(selected = true)
                    )
                }
            }
        }

        Text(
            text = if (trimmedQuery.isEmpty() && genres.size > filteredGenres.size) {
                "Showing ${filteredGenres.size} of ${genres.size} genres"
            } else {
                "${filteredGenres.size} genres"
            },
            color = Mist200,
            fontSize = 13.sp
        )

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            filteredGenres.forEach { genre ->
                val selected = genre.slug in selectedSlugs
                FilterChip(
                    selected = selected,
                    onClick = { onToggleGenre(genre.slug) },
                    label = { Text(genre.displayName, color = if (selected) Ink800 else Mist200) },
                    colors = filterChipColors(selected)
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GenrePickerSheet(
    genres: List<GenreEntity>,
    selectedSlugs: Set<String>,
    onDismiss: () -> Unit,
    onToggleGenre: (String) -> Unit
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
                .padding(horizontal = 20.dp, vertical = 16.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Browse genres",
                color = Mist100,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )
            GenreSelectionContent(
                genres = genres,
                selectedSlugs = selectedSlugs,
                onToggleGenre = onToggleGenre
            )
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

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

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun filterChipColors(selected: Boolean) = FilterChipDefaults.filterChipColors(
    selectedContainerColor = Rose500,
    selectedLabelColor = Color.White,
    containerColor = Color(0xFF252530),
    labelColor = Mist200
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomRangeBottomSheet(
    timeDimension: TimeDimension,
    currentRange: CustomRange?,
    onDismiss: () -> Unit,
    onConfirm: (CustomRange) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var rangeType by remember {
        mutableStateOf(if (currentRange is CustomRange.Relative) "RELATIVE" else "EXACT")
    }
    var relativeDays by remember {
        mutableStateOf(
            (currentRange as? CustomRange.Relative)
                ?.let { it.durationMillis / (24 * 60 * 60 * 1000L) }
                ?.toFloat()
                ?: 90f
        )
    }
    var startYear by remember {
        mutableStateOf((currentRange as? CustomRange.Exact)?.startYear?.toString() ?: "2015")
    }
    var endYear by remember {
        mutableStateOf((currentRange as? CustomRange.Exact)?.endYear?.toString() ?: "2020")
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
                text = "Custom time range",
                color = Mist100,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("RELATIVE" to "Relative", "EXACT" to "Exact dates").forEach { (type, label) ->
                    val selected = rangeType == type
                    FilterChip(
                        selected = selected,
                        onClick = { rangeType = type },
                        label = { Text(label, color = if (selected) Ink800 else Mist200) },
                        colors = filterChipColors(selected)
                    )
                }
            }

            if (rangeType == "RELATIVE") {
                val days = relativeDays.toInt()
                Text(
                    text = "Last $days days",
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

            Text(
                text = if (timeDimension == TimeDimension.WATCHED) {
                    "Watched filters use your library activity dates."
                } else {
                    "Aired filters use the anime start year."
                },
                color = Mist200,
                fontSize = 13.sp
            )

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
