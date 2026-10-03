package com.takeya.animeongaku

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.takeya.animeongaku.network.NetworkAvailability
import com.takeya.animeongaku.network.ServerReachabilityState
import com.takeya.animeongaku.network.serverReachabilityFlow
import com.takeya.animeongaku.ui.player.ServerAvailabilityNotice
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOn
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ServerAvailabilityNoticeTest {
    @get:Rule val composeRule = createComposeRule()

    @Test
    fun pendingChecksStayQuietAndConfirmedFailureClearsOnReconnect() {
        val network = MutableStateFlow(NetworkAvailability(0, true))
        val results = Channel<Boolean>(Channel.UNLIMITED)
        val probes = AtomicInteger()
        val states = serverReachabilityFlow(network, {
            results.receive().also { probes.incrementAndGet() }
        }, probeIntervalMs = 1).flowOn(Dispatchers.IO)
        val observed = MutableStateFlow(ServerReachabilityState(false, 0, false))
        val message = "Can't reach the server. Downloaded and cached songs can still play."
        composeRule.setContent {
            val server = states.collectAsState(initial = ServerReachabilityState(false, 0, false)).value
            androidx.compose.runtime.SideEffect { observed.value = server }
            MaterialTheme { ServerAvailabilityNotice(server, hasCurrentItem = true) }
        }
        // An unresolved first check and a single failed probe are not an outage.
        composeRule.onNodeWithText(message).assertDoesNotExist()
        results.trySend(false)
        composeRule.waitUntil(5_000) { probes.get() == 1 }
        composeRule.onNodeWithText(message).assertDoesNotExist()
        results.trySend(false)
        composeRule.waitUntil(5_000) { observed.value.verifiedForNetwork }
        composeRule.onNodeWithText(message).assertIsDisplayed()

        // A new connection invalidates the old failure while its probe is pending.
        network.value = NetworkAvailability(1, true)
        composeRule.waitUntil(5_000) { observed.value.networkGeneration == 1L }
        composeRule.onNodeWithText(message).assertDoesNotExist()
        results.trySend(true)
        composeRule.waitUntil(5_000) { observed.value.reachable && observed.value.verifiedForNetwork }
        composeRule.onNodeWithText(message).assertDoesNotExist()
    }
}
