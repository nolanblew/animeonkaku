package com.takeya.animeongaku.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.LinkProperties
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

enum class NetworkType {
    WIFI,
    CELLULAR,
    NONE
}

data class NetworkAvailability(
    val generation: Long,
    val isOnline: Boolean
)

internal data class DefaultNetworkState<T>(
    val network: T?,
    val generation: Long,
    val networkType: NetworkType,
    val isOnline: Boolean,
    val isUnmetered: Boolean,
    val isValidated: Boolean = false,
    val linkFingerprint: String? = null
)

/** Pure callback-state reducer. Callback arguments, rather than synchronous manager reads, own updates. */
internal class DefaultNetworkStateTracker<T>(initial: DefaultNetworkState<T>) {
    var state: DefaultNetworkState<T> = initial
        private set

    fun onAvailable(network: T): DefaultNetworkState<T> = update(
        network = network,
        networkType = if (state.network == network) state.networkType else NetworkType.NONE,
        isOnline = true,
        isUnmetered = if (state.network == network) state.isUnmetered else false,
        isValidated = if (state.network == network) state.isValidated else false,
        linkFingerprint = if (state.network == network) state.linkFingerprint else null
    )

    fun onCapabilitiesChanged(
        network: T,
        networkType: NetworkType,
        hasInternet: Boolean,
        isUnmetered: Boolean,
        isValidated: Boolean = false
    ): DefaultNetworkState<T> {
        if (state.network != network) return state
        return update(
            network,
            networkType,
            hasInternet,
            hasInternet && isUnmetered,
            isValidated,
            state.linkFingerprint
        )
    }

    fun onLinkPropertiesChanged(network: T, fingerprint: String): DefaultNetworkState<T> {
        if (state.network != network) return state
        return update(
            network,
            state.networkType,
            state.isOnline,
            state.isUnmetered,
            state.isValidated,
            fingerprint
        )
    }

    fun onLost(network: T): DefaultNetworkState<T> {
        if (state.network != network) return state
        return update(null, NetworkType.NONE, false, false, false, null)
    }

    private fun update(
        network: T?,
        networkType: NetworkType,
        isOnline: Boolean,
        isUnmetered: Boolean,
        isValidated: Boolean,
        linkFingerprint: String?
    ): DefaultNetworkState<T> {
        val current = state
        if (
            current.network == network &&
            current.networkType == networkType &&
            current.isOnline == isOnline &&
            current.isUnmetered == isUnmetered &&
            current.isValidated == isValidated &&
            current.linkFingerprint == linkFingerprint
        ) return current
        return current.copy(
            network = network,
            generation = current.generation + 1,
            networkType = networkType,
            isOnline = isOnline,
            isUnmetered = isUnmetered,
            isValidated = isValidated,
            linkFingerprint = linkFingerprint
        ).also { state = it }
    }
}

@Singleton
class ConnectivityMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val initialNetwork = connectivityManager.activeNetwork
    private val initialCapabilities = initialNetwork?.let(connectivityManager::getNetworkCapabilities)
    private val initialLinkFingerprint = initialNetwork
        ?.let(connectivityManager::getLinkProperties)
        ?.toString()
    private val tracker = DefaultNetworkStateTracker(
        DefaultNetworkState(
            network = initialNetwork,
            generation = 0L,
            networkType = initialCapabilities.toNetworkType(),
            isOnline = initialCapabilities.hasInternet(),
            isUnmetered = initialCapabilities.hasInternet() && initialCapabilities.isUnmetered(),
            isValidated = initialCapabilities.isValidated(),
            linkFingerprint = initialLinkFingerprint
        )
    )

    private val _networkType = MutableStateFlow(tracker.state.networkType)
    val networkType: StateFlow<NetworkType> = _networkType.asStateFlow()

    private val _isOnline = MutableStateFlow(tracker.state.isOnline)
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private val _isOnWifi = MutableStateFlow(_networkType.value == NetworkType.WIFI)
    val isOnWifi: StateFlow<Boolean> = _isOnWifi.asStateFlow()

    private val _isUnmetered = MutableStateFlow(tracker.state.isUnmetered)
    val isUnmetered: StateFlow<Boolean> = _isUnmetered.asStateFlow()

    private val _availability = MutableStateFlow(
        NetworkAvailability(tracker.state.generation, tracker.state.isOnline)
    )
    val availability: StateFlow<NetworkAvailability> = _availability.asStateFlow()

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            publish(tracker.onAvailable(network))
        }

        override fun onLost(network: Network) {
            publish(tracker.onLost(network))
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) {
            publish(
                tracker.onCapabilitiesChanged(
                    network = network,
                    networkType = networkCapabilities.toNetworkType(),
                    hasInternet = networkCapabilities.hasInternet(),
                    isUnmetered = networkCapabilities.isUnmetered(),
                    isValidated = networkCapabilities.isValidated()
                )
            )
        }

        override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) {
            publish(tracker.onLinkPropertiesChanged(network, linkProperties.toString()))
        }
    }

    init {
        connectivityManager.registerDefaultNetworkCallback(networkCallback)
    }

    private fun publish(state: DefaultNetworkState<Network>) {
        _networkType.value = state.networkType
        _isOnline.value = state.isOnline
        _isOnWifi.value = state.networkType == NetworkType.WIFI
        _isUnmetered.value = state.isUnmetered
        _availability.value = NetworkAvailability(state.generation, state.isOnline)
    }
}

private fun NetworkCapabilities?.hasInternet(): Boolean =
    this?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

private fun NetworkCapabilities?.isUnmetered(): Boolean =
    this?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true

private fun NetworkCapabilities?.isValidated(): Boolean =
    this?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true

private fun NetworkCapabilities?.toNetworkType(): NetworkType = when {
    this == null || !hasInternet() -> NetworkType.NONE
    hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
    hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.CELLULAR
    hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.WIFI
    else -> NetworkType.NONE
}
