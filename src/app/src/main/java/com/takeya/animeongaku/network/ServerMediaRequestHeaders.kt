package com.takeya.animeongaku.network

import com.takeya.animeongaku.sync.resolveServerUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

private const val MEDIA_PATH_MARKER = "/v1/media/"

/**
 * Re-host a stored server media URL onto the currently configured server base.
 *
 * Stored media URLs are absolute and captured at sync time, so they break if the
 * server URL later changes (LAN IP change, switching hosts, or a rebuild with a
 * different base) — the download then targets a dead host and retries forever.
 * Rebasing the `/v1/media/...` path onto the live base keeps downloads pointed at
 * the reachable server. Non server-media URLs are returned unchanged.
 */
fun rebaseServerMediaUrl(serverBaseUrl: String?, url: String): String {
    if (serverBaseUrl.isNullOrBlank()) return url
    val parsed = url.toHttpUrlOrNull() ?: return url
    val markerIndex = parsed.encodedPath.indexOf(MEDIA_PATH_MARKER)
    if (markerIndex < 0) return url
    val mediaPath = parsed.encodedPath.substring(markerIndex)
    val query = parsed.encodedQuery
    val relative = if (query.isNullOrBlank()) mediaPath else "$mediaPath?$query"
    return resolveServerUrl(serverBaseUrl, relative) ?: url
}

fun serverMediaRequestHeaders(token: String?): Map<String, String> {
    val trimmed = token?.trim().orEmpty()
    if (trimmed.isBlank()) return emptyMap()
    return mapOf("Authorization" to "Bearer $trimmed")
}

fun isServerUrl(serverBaseUrl: String?, url: String): Boolean {
    val base = serverBaseUrl?.toHttpUrlOrNull() ?: return false
    val target = url.toHttpUrlOrNull() ?: return false
    if (base.scheme != target.scheme || base.host != target.host || base.port != target.port) {
        return false
    }

    val basePath = base.encodedPath
    val normalizedBasePath = if (basePath.endsWith("/")) basePath else "$basePath/"
    return target.encodedPath == basePath.trimEnd('/') ||
        target.encodedPath.startsWith(normalizedBasePath)
}
