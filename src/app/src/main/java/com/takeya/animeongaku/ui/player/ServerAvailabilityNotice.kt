package com.takeya.animeongaku.ui.player

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import com.takeya.animeongaku.network.ServerReachabilityState
import com.takeya.animeongaku.ui.theme.Ember400

@Composable
fun ServerAvailabilityNotice(
    server: ServerReachabilityState,
    hasCurrentItem: Boolean,
    modifier: Modifier = Modifier
) {
    serverAvailabilityMessage(server, hasCurrentItem)?.let { message ->
        Text(
            text = message,
            color = Ember400,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
            modifier = modifier
        )
    }
}
