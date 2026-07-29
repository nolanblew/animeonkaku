package com.takeya.animeongaku.media

import android.net.Uri
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.takeya.animeongaku.network.isServerUrl
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

enum class MediaDataRoute(
    val usesBearerToken: Boolean,
    val usesSimpleCache: Boolean
) {
    SERVER_AUDIO(usesBearerToken = true, usesSimpleCache = true),
    DIRECT_REMOTE(usesBearerToken = false, usesSimpleCache = false),
    LOCAL(usesBearerToken = false, usesSimpleCache = false)
}

fun resolveMediaDataRoute(uri: String, activeServerBaseUrl: String?): MediaDataRoute {
    val scheme = uri.substringBefore(':', missingDelimiterValue = "").lowercase()
    if (scheme != "http" && scheme != "https") return MediaDataRoute.LOCAL
    return if (isServerUrl(activeServerBaseUrl, uri)) {
        MediaDataRoute.SERVER_AUDIO
    } else {
        MediaDataRoute.DIRECT_REMOTE
    }
}

/**
 * Authenticates each physical server request independently. OkHttp invokes network interceptors
 * again for redirects, so a same-protocol redirect cannot carry the bearer to another origin or
 * outside the configured server path.
 */
internal fun buildServerMediaHttpClient(
    activeServerBaseUrl: () -> String?,
    accessToken: () -> String?,
    connectTimeoutMs: Long = 15_000L,
    readTimeoutMs: Long = 30_000L
): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(connectTimeoutMs, TimeUnit.MILLISECONDS)
    .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS)
    .addNetworkInterceptor { chain ->
        val request = chain.request()
        val authenticated = request.newBuilder()
            .removeHeader("Authorization")
            .apply {
                if (isServerUrl(activeServerBaseUrl(), request.url.toString())) {
                    accessToken()?.trim()?.takeIf(String::isNotBlank)?.let { token ->
                        header("Authorization", "Bearer $token")
                    }
                }
            }
            .build()
        chain.proceed(authenticated)
    }
    .build()

/** Chooses the concrete Media3 source only after the final request URI is known. */
@UnstableApi
internal class OriginAwareMediaDataSourceFactory(
    private val activeServerBaseUrl: () -> String?,
    private val serverAudioFactory: DataSource.Factory,
    private val directRemoteFactory: DataSource.Factory,
    private val localFactory: DataSource.Factory
) : DataSource.Factory {
    override fun createDataSource(): DataSource = OriginAwareMediaDataSource(
        activeServerBaseUrl,
        serverAudioFactory,
        directRemoteFactory,
        localFactory
    )
}

@UnstableApi
private class OriginAwareMediaDataSource(
    private val activeServerBaseUrl: () -> String?,
    private val serverAudioFactory: DataSource.Factory,
    private val directRemoteFactory: DataSource.Factory,
    private val localFactory: DataSource.Factory
) : DataSource {
    private val listeners = mutableListOf<TransferListener>()
    private var delegate: DataSource? = null

    override fun addTransferListener(transferListener: TransferListener) {
        listeners += transferListener
        delegate?.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        check(delegate == null) { "DataSource is already open" }
        val factory = when (resolveMediaDataRoute(dataSpec.uri.toString(), activeServerBaseUrl())) {
            MediaDataRoute.SERVER_AUDIO -> serverAudioFactory
            MediaDataRoute.DIRECT_REMOTE -> directRemoteFactory
            MediaDataRoute.LOCAL -> localFactory
        }
        return factory.createDataSource().also { selected ->
            listeners.forEach(selected::addTransferListener)
            delegate = selected
        }.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        checkNotNull(delegate) { "DataSource is not open" }.read(buffer, offset, length)

    override fun getUri(): Uri? = delegate?.uri

    override fun getResponseHeaders(): Map<String, List<String>> =
        delegate?.responseHeaders ?: emptyMap()

    override fun close() {
        val selected = delegate
        delegate = null
        selected?.close()
    }
}
