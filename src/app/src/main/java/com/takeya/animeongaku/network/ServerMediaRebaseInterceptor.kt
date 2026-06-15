package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.server.ServerSettingsStore
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Re-host stored server media URLs onto the currently configured server base.
 *
 * Artwork URLs are persisted absolute at sync time (see [com.takeya.animeongaku.sync.resolveServerUrl]),
 * so they freeze to whatever host the server had then. After a host change (LAN IP
 * change, switching hosts, or a rebuild with a different base) those stored URLs
 * point at a dead host and Coil renders broken/"failed" artwork — even though the
 * server still serves the same image. Rebasing the `/v1/media/...` path onto the
 * live base keeps image loads pointed at the reachable server. Non server-media
 * URLs (e.g. external origins) pass through untouched.
 *
 * This mirrors the rebasing already applied on the download path (DownloadWorker)
 * and the playback path (PlaybackMediaItems), closing the gap on the Coil image path.
 */
@Singleton
class ServerMediaRebaseInterceptor @Inject constructor(
    private val settingsStore: ServerSettingsStore
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val original = request.url.toString()
        val rebased = rebaseServerMediaUrl(settingsStore.serverBaseUrl, original)
        if (rebased == original) return chain.proceed(request)
        val newUrl = rebased.toHttpUrlOrNull() ?: return chain.proceed(request)
        return chain.proceed(request.newBuilder().url(newUrl).build())
    }
}
