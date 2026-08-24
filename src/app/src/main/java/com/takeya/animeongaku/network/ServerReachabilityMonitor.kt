package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.server.ServerSettingsStore
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request

internal fun serverReachabilityFlow(
    networkOnline: Flow<Boolean>,
    probe: suspend () -> Boolean,
    probeIntervalMs: Long
): Flow<Boolean> = channelFlow {
    networkOnline.distinctUntilChanged().collectLatest { online ->
        if (!online) {
            send(false)
        } else {
            while (currentCoroutineContext().isActive) {
                send(runCatching { probe() }.getOrDefault(false))
                delay(probeIntervalMs)
            }
        }
    }
}.distinctUntilChanged()

/**
 * Process-lifetime view of whether the configured Anime Ongaku server can actually answer.
 * Android's network capability only proves that a network exists; it does not prove that the
 * self-hosted server is running or reachable from that network.
 */
@Singleton
class ServerReachabilityMonitor @Inject constructor(
    connectivityMonitor: ConnectivityMonitor,
    private val serverSettingsStore: ServerSettingsStore,
    @Named("base") baseClient: OkHttpClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val probeClient = baseClient.newBuilder()
        .apply { interceptors().removeAll { it is RetryInterceptor } }
        .connectTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .readTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .callTimeout(PROBE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        .build()
    private val _isReachable = MutableStateFlow(connectivityMonitor.isOnline.value)
    val isReachable: StateFlow<Boolean> = _isReachable.asStateFlow()

    init {
        scope.launch {
            serverReachabilityFlow(
                networkOnline = connectivityMonitor.isOnline,
                probe = ::probeServer,
                probeIntervalMs = PROBE_INTERVAL_MS
            ).collect { _isReachable.value = it }
        }
    }

    private fun probeServer(): Boolean {
        val baseUrl = serverSettingsStore.serverBaseHttpUrl() ?: return false
        val healthUrl = baseUrl.resolve("healthz") ?: return false
        val request = Request.Builder().url(healthUrl).get().build()
        return probeClient.newCall(request).execute().use { response -> response.isSuccessful }
    }

    private companion object {
        const val PROBE_INTERVAL_MS = 10_000L
        const val PROBE_TIMEOUT_SECONDS = 3L
    }
}
