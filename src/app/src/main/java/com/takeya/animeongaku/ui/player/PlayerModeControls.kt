package com.takeya.animeongaku.ui.player

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.focusGroup
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.ViewCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.takeya.animeongaku.media.PlaybackMode
import com.takeya.animeongaku.ui.theme.Ink800
import com.takeya.animeongaku.ui.theme.Ink900
import com.takeya.animeongaku.ui.theme.Mist100
import com.takeya.animeongaku.ui.theme.Mist200
import com.takeya.animeongaku.ui.theme.Rose500
import kotlinx.coroutines.delay
import androidx.compose.ui.platform.LocalAccessibilityManager

@Composable
fun PlayerModeSelector(
    state: PlayerModeUiState,
    isExpanded: Boolean,
    onModeSelected: (PlaybackMode) -> Unit,
    modifier: Modifier = Modifier
) {
    if (!state.visible || !isExpanded) return
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(
            modifier = Modifier
                .background(Ink900.copy(alpha = 0.78f), RoundedCornerShape(50))
                .padding(3.dp)
                .selectableGroup(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            state.options.forEach { mode ->
                val selected = state.actualMode == mode
                val label = mode.displayLabel()
                Box(
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .selectable(
                            selected = selected,
                            role = Role.RadioButton,
                            onClick = { onModeSelected(mode) }
                        )
                        .semantics { contentDescription = "$label playback mode" }
                        .padding(horizontal = 1.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = label,
                        color = if (selected) Ink900 else Mist200,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier
                            .background(
                                if (selected) Rose500 else Color.Transparent,
                                RoundedCornerShape(50)
                            )
                            .padding(horizontal = 11.dp, vertical = 7.dp)
                    )
                }
            }
        }
        state.retainedIntentText?.let { text ->
            Text(
                text = text,
                color = Mist200.copy(alpha = 0.78f),
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.semantics {
                    liveRegion = LiveRegionMode.Polite
                    stateDescription = text
                }
            )
        }
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun PlayerVideoSurface(
    controller: Player?,
    cropToBounds: Boolean = false,
    modifier: Modifier = Modifier
) {
    AndroidView(
        factory = { context ->
            PlayerView(context).apply {
                useController = false
                resizeMode = if (cropToBounds) {
                    AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                } else {
                    AspectRatioFrameLayout.RESIZE_MODE_FIT
                }
                setShutterBackgroundColor(android.graphics.Color.BLACK)
                player = controller
            }
        },
        update = { view -> view.player = controller },
        modifier = modifier.background(Color.Black),
        onRelease = { view -> view.player = null }
    )
}

@Composable
fun LandscapeVideoOverlay(
    controller: Player?,
    isPlaying: Boolean,
    isLiked: Boolean,
    isDisliked: Boolean,
    onToggleLike: () -> Unit,
    onToggleDislike: () -> Unit,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier
) {
    HideSystemBarsForVideo()
    val accessibilityManager = LocalAccessibilityManager.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val platformAccessibilityManager = remember(context) {
        context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? android.view.accessibility.AccessibilityManager
    }
    var touchExplorationEnabled by remember(platformAccessibilityManager) {
        mutableStateOf(platformAccessibilityManager?.isTouchExplorationEnabled == true)
    }
    DisposableEffect(platformAccessibilityManager) {
        val listener = android.view.accessibility.AccessibilityManager.TouchExplorationStateChangeListener {
            touchExplorationEnabled = it
        }
        platformAccessibilityManager?.addTouchExplorationStateChangeListener(listener)
        onDispose {
            platformAccessibilityManager?.removeTouchExplorationStateChangeListener(listener)
        }
    }
    var controlsVisible by remember { mutableStateOf(true) }
    var controlsFocused by remember { mutableStateOf(false) }
    val recommendedTimeoutMillis = accessibilityManager?.calculateRecommendedTimeoutMillis(
        originalTimeoutMillis = 3_000L,
        containsIcons = true,
        containsText = false,
        containsControls = true
    ) ?: 3_000L
    val autoHideDelayMillis = videoControlsAutoHideDelayMillis(
        isPlaying = isPlaying,
        controlsVisible = controlsVisible,
        touchExplorationEnabled = touchExplorationEnabled,
        controlsFocused = controlsFocused,
        recommendedTimeoutMillis = recommendedTimeoutMillis
    )
    LaunchedEffect(autoHideDelayMillis, controlsVisible, isPlaying, controlsFocused) {
        if (autoHideDelayMillis != null) {
            delay(autoHideDelayMillis)
            controlsVisible = false
        }
    }

    Box(modifier = modifier.background(Color.Black)) {
        PlayerVideoSurface(controller = controller, modifier = Modifier.fillMaxSize())
        Box(
            modifier = Modifier
                .fillMaxSize()
                .clickable(
                    onClickLabel = if (controlsVisible) "Hide video controls" else "Show video controls"
                ) { controlsVisible = !controlsVisible }
        )
        AnimatedVisibility(
            visible = controlsVisible,
            modifier = Modifier.align(Alignment.BottomCenter)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Ink900.copy(alpha = 0.82f))
                    .focusGroup()
                    .onFocusChanged { controlsFocused = it.hasFocus }
                    .padding(horizontal = 28.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                VideoControlButton("Dislike", onToggleDislike) {
                    Icon(Icons.Rounded.ThumbDown, "Dislike", tint = if (isDisliked) Rose500 else Mist100)
                }
                VideoControlButton("Previous", onPrevious) {
                    Icon(Icons.Rounded.SkipPrevious, "Previous", tint = Mist100)
                }
                VideoControlButton("Play or pause", onPlayPause, prominent = true) {
                    Icon(
                        if (isPlaying) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        "Play or pause",
                        tint = Ink900,
                        modifier = Modifier.size(32.dp)
                    )
                }
                VideoControlButton("Next", onNext) {
                    Icon(Icons.Rounded.SkipNext, "Next", tint = Mist100)
                }
                VideoControlButton("Like", onToggleLike) {
                    Icon(Icons.Rounded.ThumbUp, "Like", tint = if (isLiked) Rose500 else Mist100)
                }
            }
        }
    }
}

fun videoControlsAutoHideDelayMillis(
    isPlaying: Boolean,
    controlsVisible: Boolean,
    touchExplorationEnabled: Boolean,
    controlsFocused: Boolean,
    recommendedTimeoutMillis: Long
): Long? = recommendedTimeoutMillis.takeIf {
    isPlaying && controlsVisible && !touchExplorationEnabled && !controlsFocused
}

@Composable
private fun VideoControlButton(
    label: String,
    onClick: () -> Unit,
    prominent: Boolean = false,
    content: @Composable () -> Unit
) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(if (prominent) 58.dp else 48.dp)
            .background(if (prominent) Rose500 else Color.Transparent, CircleShape)
            .semantics { contentDescription = label }
    ) { content() }
}

@Composable
private fun HideSystemBarsForVideo() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(context, view) {
        val window = context.findActivity()?.window
        val insetsController = window?.let { WindowCompat.getInsetsController(it, view) }
        val previousBehavior = insetsController?.systemBarsBehavior
        val systemBarsWereVisible = ViewCompat.getRootWindowInsets(view)
            ?.isVisible(WindowInsetsCompat.Type.systemBars())
            ?: true
        insetsController?.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            if (previousBehavior != null) insetsController?.systemBarsBehavior = previousBehavior
            if (systemBarsWereVisible) {
                insetsController?.show(WindowInsetsCompat.Type.systemBars())
            } else {
                insetsController?.hide(WindowInsetsCompat.Type.systemBars())
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
