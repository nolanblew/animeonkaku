package com.takeya.animeongaku

import com.takeya.animeongaku.network.DefaultNetworkState
import com.takeya.animeongaku.network.DefaultNetworkStateTracker
import com.takeya.animeongaku.network.NetworkType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectivityMonitorTest {
    @Test
    fun `default network handoff advances generation while online remains true`() {
        val tracker = DefaultNetworkStateTracker(
            DefaultNetworkState("wifi", 0L, NetworkType.WIFI, isOnline = true, isUnmetered = true)
        )

        val available = tracker.onAvailable("cell")
        val cellular = tracker.onCapabilitiesChanged(
            network = "cell",
            networkType = NetworkType.CELLULAR,
            hasInternet = true,
            isUnmetered = false
        )

        assertTrue(available.isOnline)
        assertTrue(cellular.isOnline)
        assertEquals(NetworkType.CELLULAR, cellular.networkType)
        assertTrue(cellular.generation > available.generation)
    }

    @Test
    fun `stale callback from old network cannot overwrite current default`() {
        val tracker = DefaultNetworkStateTracker(
            DefaultNetworkState("wifi", 0L, NetworkType.WIFI, isOnline = true, isUnmetered = true)
        )
        tracker.onAvailable("cell")
        val current = tracker.onCapabilitiesChanged("cell", NetworkType.CELLULAR, true, false)

        val afterStaleLoss = tracker.onLost("wifi")
        val afterStaleCapabilities = tracker.onCapabilitiesChanged("wifi", NetworkType.WIFI, true, true)

        assertEquals(current, afterStaleLoss)
        assertEquals(current, afterStaleCapabilities)
    }

    @Test
    fun `internet capability does not require platform validation`() {
        val tracker = DefaultNetworkStateTracker(
            DefaultNetworkState<String>(null, 0L, NetworkType.NONE, isOnline = false, isUnmetered = false)
        )
        tracker.onAvailable("lan")

        val localLan = tracker.onCapabilitiesChanged(
            network = "lan",
            networkType = NetworkType.WIFI,
            hasInternet = true,
            isUnmetered = true
        )

        assertTrue(localLan.isOnline)
        assertTrue(localLan.isUnmetered)
        assertFalse(localLan.networkType == NetworkType.NONE)
    }

    @Test
    fun `validation and link changes advance generation without defining online`() {
        val tracker = DefaultNetworkStateTracker(
            DefaultNetworkState("wifi", 0L, NetworkType.WIFI, isOnline = true, isUnmetered = true)
        )

        val validated = tracker.onCapabilitiesChanged(
            network = "wifi",
            networkType = NetworkType.WIFI,
            hasInternet = true,
            isUnmetered = true,
            isValidated = true
        )
        val newDns = tracker.onLinkPropertiesChanged("wifi", "dns=192.168.1.1")

        assertTrue(validated.isOnline)
        assertTrue(validated.isValidated)
        assertEquals(validated.generation + 1L, newDns.generation)
    }
}
