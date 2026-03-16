package com.takeya.animeongaku.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
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

@Singleton
class ConnectivityMonitor @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val _networkType = MutableStateFlow(getCurrentNetworkType())
    val networkType: StateFlow<NetworkType> = _networkType.asStateFlow()

    private val _isOnline = MutableStateFlow(_networkType.value != NetworkType.NONE)
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private val _isOnWifi = MutableStateFlow(_networkType.value == NetworkType.WIFI)
    val isOnWifi: StateFlow<Boolean> = _isOnWifi.asStateFlow()

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            updateState()
        }

        override fun onLost(network: Network) {
            updateState()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities
        ) {
            updateState()
        }
    }

    init {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        connectivityManager.registerNetworkCallback(request, networkCallback)
    }

    private fun updateState() {
        val type = getCurrentNetworkType()
        _networkType.value = type
        _isOnline.value = type != NetworkType.NONE
        _isOnWifi.value = type == NetworkType.WIFI
    }

    private fun getNetworkTypeForNetwork(network: Network): NetworkType {
        val capabilities = connectivityManager.getNetworkCapabilities(network)
            ?: return NetworkType.NONE
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            return NetworkType.NONE
        }
        return when {
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkType.WIFI
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> NetworkType.CELLULAR
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> NetworkType.WIFI
            else -> NetworkType.NONE
        }
    }

    private fun getCurrentNetworkType(): NetworkType {
        val activeNetwork = connectivityManager.activeNetwork
        if (activeNetwork != null) {
            val type = getNetworkTypeForNetwork(activeNetwork)
            if (type != NetworkType.NONE) return type
        }
        // Fallback: check all networks (activeNetwork can be null briefly on cold start)
        for (network in connectivityManager.allNetworks) {
            val type = getNetworkTypeForNetwork(network)
            if (type != NetworkType.NONE) return type
        }
        return NetworkType.NONE
    }
}
