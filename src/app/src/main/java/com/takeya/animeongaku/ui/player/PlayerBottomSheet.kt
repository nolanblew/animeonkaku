package com.takeya.animeongaku.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.BottomSheetScaffoldState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerBottomSheet(
    scaffoldState: BottomSheetScaffoldState,
    peekHeight: androidx.compose.ui.unit.Dp,
    content: @Composable () -> Unit
) {
    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        sheetPeekHeight = peekHeight,
        sheetContent = {
            Box(Modifier.fillMaxSize()) {
                // We will render PlayerScreen and crossfade to MiniPlayer
                // But for now, just render PlayerScreen
            }
        },
        content = { padding ->
            Box(Modifier.fillMaxSize()) {
                content()
            }
        }
    )
}
