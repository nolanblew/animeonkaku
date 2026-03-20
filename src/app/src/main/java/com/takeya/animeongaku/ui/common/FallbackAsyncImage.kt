package com.takeya.animeongaku.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.request.ImageRequest
import coil.size.Size

/**
 * An AsyncImage that tries each URL in [urls] in order.
 * If the current URL fails to load, it advances to the next one automatically.
 * Uses Size.ORIGINAL for the first (highest quality) URL; subsequent fallbacks
 * use the default size to maximise cache-hit likelihood.
 */
@Composable
fun FallbackAsyncImage(
    urls: List<String>,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    alpha: Float = 1f
) {
    val validUrls = remember(urls) { urls.filter { it.isNotBlank() } }
    if (validUrls.isEmpty()) return

    var currentIndex by remember(validUrls) { mutableIntStateOf(0) }
    val currentUrl = validUrls.getOrNull(currentIndex) ?: return
    val context = LocalContext.current

    val model = remember(currentUrl, currentIndex) {
        ImageRequest.Builder(context)
            .data(currentUrl)
            .apply { if (currentIndex == 0) size(Size.ORIGINAL) }
            .memoryCacheKey("$currentUrl#fallback-$currentIndex")
            .crossfade(true)
            .build()
    }

    AsyncImage(
        model = model,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
        alpha = alpha,
        onState = { state ->
            if (state is AsyncImagePainter.State.Error && currentIndex < validUrls.lastIndex) {
                currentIndex++
            }
        }
    )
}
