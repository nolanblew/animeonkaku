package com.takeya.animeongaku.network

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

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
