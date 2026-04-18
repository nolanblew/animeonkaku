package com.takeya.animeongaku.ui.dynamic

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import com.takeya.animeongaku.data.filter.compileSimpleFilter
import com.takeya.animeongaku.ui.player.MiniPlayerHeight
import com.takeya.animeongaku.ui.theme.Ink700
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500

@Composable
fun DynamicSimpleCreatorScreen(
    onNavigateToPreview: () -> Unit,
    onNavigateToAdvanced: () -> Unit,
    onBack: () -> Unit,
    viewModel: DynamicPlaylistDraftViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val preview by viewModel.previewResult.collectAsStateWithLifecycle()
    val simpleState = state.simple
    val backgroundBrush = Brush.verticalGradient(listOf(Ink900, Ink800, Ink700))
    val filterIsEmpty = (compileSimpleFilter(simpleState) as? FilterNode.And)?.children?.isEmpty() != false

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(brush = backgroundBrush)
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(bottom = MiniPlayerHeight + 164.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
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
                        text = if (state.editingPlaylistId != null) "Edit Smart Playlist" else "New Smart Playlist",
                        color = Mist100,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = 4.dp)
                    )
                }
            }

            item {
                DynamicSimpleFilterSections(
                    state = simpleState,
                    availableGenres = state.availableGenres,
                    onTimeDimensionChange = viewModel::setTimeDimension,
                    onTimeModeChange = viewModel::setTimeMode,
                    onCustomRangeChange = viewModel::setCustomRange,
                    onSeasonToggle = viewModel::toggleSeason,
                    onGenreToggle = viewModel::toggleGenreSlug,
                    onGenreMatchAllChange = viewModel::setGenreMatchAll,
                    onMinRatingChange = viewModel::setMinRating,
                    onRatingSourceChange = viewModel::setRatingSource,
                    onSubtypeToggle = viewModel::toggleSubtype,
                    onWatchingStatusToggle = viewModel::toggleWatchingStatus,
                    onThemeTypeToggle = viewModel::toggleThemeType
                )
            }

            item { Spacer(modifier = Modifier.height(12.dp)) }
        }

        Card(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(bottom = MiniPlayerHeight)
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
                    if (!state.isEditLocked) {
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
                            text = "Save Playlist",
                            color = if (filterIsEmpty) Mist200 else Color.White,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }
    }
}
