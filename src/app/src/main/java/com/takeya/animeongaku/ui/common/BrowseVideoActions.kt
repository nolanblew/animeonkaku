package com.takeya.animeongaku.ui.common

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.media.NowPlayingManager
import com.takeya.animeongaku.media.playVideoContext
import com.takeya.animeongaku.ui.player.VideoContentWarning

data class BrowseVideoStartRequest(
    val contextLabel: String,
    val themes: List<ThemeEntity>,
    val modesByThemeId: Map<Long, ThemeModeEntity>,
    val animeMap: Map<Long, AnimeEntity>,
    val warning: VideoContentWarning?
) {
    /**
     * Marked videos anywhere in the requested context are authorized up front. This means an
     * audio-fallback first entry can safely retry Video later without showing content first.
     */
    fun startIfStillValid(
        manager: NowPlayingManager,
        isOnline: Boolean,
        currentThemes: List<ThemeEntity>,
        currentModesByThemeId: Map<Long, ThemeModeEntity>,
        currentContextLabel: String = contextLabel,
        currentAnimeMap: Map<Long, AnimeEntity> = animeMap
    ): Boolean {
        if (contextLabel != currentContextLabel || animeMap != currentAnimeMap) return false
        if (themes != currentThemes) return false
        val currentRelevantModes = currentThemes.mapNotNull { currentModesByThemeId[it.id] }
            .associateBy { it.themeId }
        if (modesByThemeId != currentRelevantModes) return false
        if (!BrowseVideoActionPolicy.context(isOnline, currentRelevantModes.values)) return false
        manager.playVideoContext(contextLabel, themes, modesByThemeId, animeMap = animeMap)
        return true
    }
}

/** Listener-visible availability contract for temporary browse-surface Video sessions. */
object BrowseVideoActionPolicy {
    fun singleTheme(isOnline: Boolean, mode: ThemeModeEntity?): Boolean =
        isOnline && mode.hasUsableVideo()

    fun context(isOnline: Boolean, modes: Collection<ThemeModeEntity>): Boolean =
        isOnline && modes.any { it.hasUsableVideo() }

    fun request(
        isOnline: Boolean,
        contextLabel: String,
        themes: List<ThemeEntity>,
        modesByThemeId: Map<Long, ThemeModeEntity>,
        animeMap: Map<Long, AnimeEntity> = emptyMap()
    ): BrowseVideoStartRequest? {
        val relevantModes = themes.mapNotNull { modesByThemeId[it.id] }.associateBy { it.themeId }
        if (!context(isOnline, relevantModes.values)) return null
        val videoModes = relevantModes.values.filter { it.hasUsableVideo() }
        val spoiler = videoModes.any { it.videoSpoiler }
        val nsfw = videoModes.any { it.videoNsfw }
        return BrowseVideoStartRequest(
            contextLabel = contextLabel,
            themes = themes,
            modesByThemeId = relevantModes,
            animeMap = animeMap,
            warning = if (spoiler || nsfw) VideoContentWarning(spoiler, nsfw) else null
        )
    }

    private fun ThemeModeEntity?.hasUsableVideo(): Boolean =
        !this?.videoUrl.isNullOrBlank()
}

@Composable
fun BrowseVideoWarningDialog(
    request: BrowseVideoStartRequest,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    val warning = request.warning ?: return
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Content warning") },
        text = { Text("${warning.message} This warning applies to marked videos in this queue.") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Play video") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
