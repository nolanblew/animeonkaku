package com.takeya.animeongaku.media

import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

/**
 * Main-thread owner of the app's controller bind. Background work must not restart an idle media
 * service. A service started by an external controller also authorizes binding while it exists.
 * An established connection is retained so playback and external controls keep working.
 */
internal class PlaybackControllerConnection<T : Any>(
    private val scope: CoroutineScope,
    private val executor: Executor,
    private val connect: () -> ListenableFuture<T>,
    private val releaseFuture: (ListenableFuture<T>) -> Unit,
    private val release: (T) -> Unit,
    private val onConnected: (T) -> Unit,
    private val onDisconnected: (T) -> Unit,
    private val onFailure: (Throwable, Int) -> Unit,
) {
    private var foreground = false
    private var serviceAvailable = false
    private var enabled = false
    private var connected: T? = null
    private var pending: ListenableFuture<T>? = null
    private var retry: Job? = null
    private var generation = 0L
    private var failures = 0

    fun enable() {
        enabled = true
        connectIfNeeded()
    }

    fun setForeground(value: Boolean) {
        if (foreground == value) return
        foreground = value
        if (value) failures = 0
        updateConnectionPermission()
    }

    fun setServiceAvailable(value: Boolean) {
        if (serviceAvailable == value) return
        serviceAvailable = value
        updateConnectionPermission()
    }

    private fun updateConnectionPermission() {
        if (foreground || serviceAvailable) {
            connectIfNeeded()
        } else {
            // Invalidate first: cancellation can deliver a future's listener synchronously.
            generation++
            retry?.cancel()
            retry = null
            val abandoned = pending
            pending = null
            abandoned?.let(releaseFuture)
        }
    }

    fun disconnected(value: T, error: Throwable) {
        if (connected !== value) return
        connected = null
        onDisconnected(value)
        release(value)
        failed(error)
    }

    private fun connectIfNeeded() {
        if (!enabled || (!foreground && !serviceAvailable) || connected != null || pending != null || retry != null) return
        val attempt = ++generation
        try {
            // SessionToken/Builder/buildAsync can throw before returning a future.
            val future = connect()
            pending = future
            future.addListener({
                if (attempt != generation || pending !== future) return@addListener
                pending = null
                try {
                    val value = future.get()
                    connected = value
                    failures = 0
                    onConnected(value)
                } catch (error: Exception) {
                    val value = connected
                    connected = null
                    if (value != null) {
                        onDisconnected(value)
                        release(value)
                    }
                    failed(error)
                }
            }, executor)
        } catch (error: Exception) {
            val abandoned = pending
            pending = null
            abandoned?.let(releaseFuture)
            failed(error)
        }
    }

    private fun failed(error: Throwable) {
        val attempt = failures++
        onFailure(error, attempt + 1)
        if (!enabled || (!foreground && !serviceAvailable)) return
        retry?.cancel()
        retry = scope.launch {
            delay(controllerConnectionRetryDelayMs(error, attempt))
            retry = null
            connectIfNeeded()
        }
    }
}

/** Resolution is asynchronous: SupervisorJob alone does not catch a failed restore child. */
internal fun CoroutineScope.launchPlaybackRestoration(
    restore: suspend () -> Unit,
    isCurrent: () -> Boolean,
    onReady: () -> Unit,
    onFailure: (Exception) -> Unit,
): Job = launch {
    try {
        restore()
        coroutineContext.ensureActive()
        if (isCurrent()) onReady()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        if (isCurrent()) onFailure(error)
    }
}
