package com.takeya.animeongaku.network

import com.takeya.animeongaku.data.server.ServerSettingsStore
import java.util.concurrent.TimeUnit
import java.io.IOException
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.CancellationException
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
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import kotlin.coroutines.resume

internal fun serverReachabilityFlow(
    networkOnline: Flow<Boolean>,
    probe: suspend () -> Boolean,
    probeIntervalMs: Long,
    failuresBeforeUnavailable: Int = 2,
    failureRetryIntervalMs: Long = probeIntervalMs,
): Flow<Boolean> = channelFlow {
    require(failuresBeforeUnavailable > 0)
    networkOnline.distinctUntilChanged().collectLatest { online ->
        if (!online) {
            send(false)
        } else {
            var consecutiveFailures = 0
            while (currentCoroutineContext().isActive) {
                val reachable = try {
                    probe()
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (_: Exception) {
                    false
                }
                if (reachable) {
                    consecutiveFailures = 0
                    send(true)
                    delay(probeIntervalMs)
                } else {
                    consecutiveFailures++
                    if (consecutiveFailures >= failuresBeforeUnavailable) send(false)
                    delay(
                        if (consecutiveFailures < failuresBeforeUnavailable) {
                            failureRetryIntervalMs
                        } else {
                            probeIntervalMs
                        }
                    )
                }
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
    private val probeDispatcher = Dispatcher().apply {
        maxRequests = 2
        maxRequestsPerHost = 2
    }
    private val probeClient = baseClient.newBuilder()
        .apply { interceptors().removeAll { it is RetryInterceptor } }
        .dispatcher(probeDispatcher)
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
                probeIntervalMs = PROBE_INTERVAL_MS,
                failureRetryIntervalMs = FAILURE_RETRY_INTERVAL_MS,
            ).collect { _isReachable.value = it }
        }
    }

    private suspend fun probeServer(): Boolean {
        val baseUrl = serverSettingsStore.serverBaseHttpUrl() ?: return false
        val healthUrl = baseUrl.resolve("healthz") ?: return false
        val request = Request.Builder().url(healthUrl).get().build()
        val call = probeClient.newCall(request)
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resume(false)
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        if (continuation.isActive) continuation.resume(it.isSuccessful)
                    }
                }
            })
        }
    }

    private companion object {
        const val PROBE_INTERVAL_MS = 10_000L
        const val FAILURE_RETRY_INTERVAL_MS = 1_000L
        const val PROBE_TIMEOUT_SECONDS = 3L
    }
}
