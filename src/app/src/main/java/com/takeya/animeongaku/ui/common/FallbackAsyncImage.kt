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
 * Uses constraint-sized requests by default so dense lists do not decode full
 * cover images for small thumbnails.
 */
@Composable
fun FallbackAsyncImage(
    urls: List<String>,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    alpha: Float = 1f,
    loadOriginalSize: Boolean = false,
    crossfade: Boolean = false
) {
    val validUrls = remember(urls) { urls.filter { it.isNotBlank() } }
    if (validUrls.isEmpty()) return

    val attemptOrder = remember(validUrls) { fallbackAsyncImageAttemptOrder(validUrls) }
    var attemptPosition by remember(validUrls) { mutableIntStateOf(0) }
    val currentIndex = attemptOrder.getOrNull(attemptPosition) ?: return
    val currentUrl = validUrls.getOrNull(currentIndex) ?: return
    val context = LocalContext.current
    val policy = remember(loadOriginalSize) {
        fallbackAsyncImageRequestPolicy(loadOriginalSize)
    }

    val model = remember(currentUrl, policy, crossfade) {
        ImageRequest.Builder(context)
            .data(currentUrl)
            .apply { if (policy.useOriginalSize) size(Size.ORIGINAL) }
            .crossfade(crossfade)
            .build()
    }

    AsyncImage(
        model = model,
        contentDescription = contentDescription,
        modifier = modifier,
        contentScale = contentScale,
        alpha = alpha,
        onState = { state ->
            when (state) {
                is AsyncImagePainter.State.Error -> {
                    if (attemptPosition < attemptOrder.lastIndex) {
                        attemptPosition++
                    } else {
                        fallbackAsyncImageSuccessCache.clear(validUrls)
                    }
                }
                is AsyncImagePainter.State.Success -> fallbackAsyncImageSuccessCache.recordSuccess(
                    validUrls,
                    currentIndex
                )
                else -> Unit
            }
        }
    )
}

internal data class FallbackAsyncImageRequestPolicy(
    val useOriginalSize: Boolean
)

internal fun fallbackAsyncImageRequestPolicy(loadOriginalSize: Boolean): FallbackAsyncImageRequestPolicy =
    FallbackAsyncImageRequestPolicy(useOriginalSize = loadOriginalSize)

internal fun fallbackAsyncImageInitialIndex(urls: List<String>): Int =
    fallbackAsyncImageSuccessCache.lastSuccessfulIndex(urls)
        ?.coerceIn(0, urls.lastIndex)
        ?: 0

internal fun fallbackAsyncImageAttemptOrder(urls: List<String>): List<Int> {
    if (urls.isEmpty()) return emptyList()
    val preferred = fallbackAsyncImageInitialIndex(urls)
    return buildList(urls.size) {
        add(preferred)
        urls.indices.filterTo(this) { it != preferred }
    }
}

private const val MAX_FALLBACK_SUCCESS_ENTRIES = 512

internal val fallbackAsyncImageSuccessCache = FallbackAsyncImageSuccessCache()

internal class FallbackAsyncImageSuccessCache {
    private val cache = object : LinkedHashMap<List<String>, Int>(MAX_FALLBACK_SUCCESS_ENTRIES, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<List<String>, Int>?): Boolean =
            size > MAX_FALLBACK_SUCCESS_ENTRIES
    }

    @Synchronized
    fun lastSuccessfulIndex(urls: List<String>): Int? = cache[urls]

    @Synchronized
    fun recordSuccess(urls: List<String>, index: Int) {
        val key = urls.toList()
        if (index <= 0) {
            cache.remove(key)
        } else {
            cache[key] = index
        }
    }

    @Synchronized
    fun clear(urls: List<String>) {
        cache.remove(urls)
    }

    @Synchronized
    fun clear() {
        cache.clear()
    }
}
