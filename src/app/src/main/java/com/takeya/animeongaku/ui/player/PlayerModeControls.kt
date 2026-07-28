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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
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

/**
 * The playback-mode control lives inline in the Now Playing eyebrow row, beside
 * the anime name and theme tag.
 *
 * It renders as quiet text rather than a filled segmented control on purpose.
 * The previous design floated a saturated capsule over the top of the artwork —
 * covering the one element on this screen that should never be obscured, and
 * carrying the loudest colour on the screen for something the user touches
 * perhaps once a session. Here the current mode stays readable at a glance and
 * the alternatives are one tap away, without competing for first fixation.
 */
@Composable
fun PlayerModeChip(
    state: PlayerModeUiState,
    onModeSelected: (PlaybackMode) -> Unit,
    modifier: Modifier = Modifier
) {
    if (!state.showsModeChip()) return
    val current = state.actualMode ?: state.options.first()
    val label = current.displayLabel()
    val retained = state.retainedIntentText
    var menuOpen by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        Row(
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .clip(RoundedCornerShape(50))
                .clickable(
                    role = Role.Button,
                    onClickLabel = "Change playback mode"
                ) { menuOpen = true }
                .padding(horizontal = 2.dp, vertical = 2.dp)
                .semantics {
                    contentDescription = "Playback mode: $label"
                    // The retained-intent explanation no longer has a line of
                    // its own, so the chip carries the announcement instead.
                    if (retained != null) {
                        stateDescription = retained
                        liveRegion = LiveRegionMode.Polite
                    }
                },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                color = Mist200,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium),
                maxLines = 1
            )
            Icon(
                imageVector = Icons.Rounded.ArrowDropDown,
                contentDescription = null,
                tint = Mist200,
                modifier = Modifier.size(18.dp)
            )
        }
        // Now Playing paints its own dark Ink/Mist palette regardless of the
        // system theme, but a DropdownMenu is a popup that reads the ambient
        // colorScheme — which is the light scheme on a light-mode device. Pin
        // the menu to the dark surface so it cannot render as a white card on
        // top of this screen.
        MaterialTheme(
            colorScheme = MaterialTheme.colorScheme.copy(
                surface = Ink800,
                surfaceContainer = Ink800,
                onSurface = Mist100,
                onSurfaceVariant = Mist200
            )
        ) {
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                if (retained != null) {
                    Text(
                        text = retained,
                        color = Mist200.copy(alpha = 0.78f),
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
                state.options.forEach { mode ->
                    val isSelected = mode == state.actualMode
                    val modeLabel = mode.displayLabel()
                    DropdownMenuItem(
                        text = { Text(modeLabel) },
                        onClick = {
                            menuOpen = false
                            onModeSelected(mode)
                        },
                        leadingIcon = {
                            if (isSelected) {
                                Icon(Icons.Rounded.Check, contentDescription = null, tint = Rose500)
                            } else {
                                Spacer(Modifier.size(24.dp))
                            }
                        },
                        modifier = Modifier.semantics {
                            role = Role.RadioButton
                            selected = isSelected
                            contentDescription = "$modeLabel playback mode"
                        }
                    )
                }
            }
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
