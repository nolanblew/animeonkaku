package com.takeya.animeongaku.ui.player

import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext

@Composable
fun CastButton() {
    AndroidView(
        modifier = Modifier.size(40.dp),
        factory = { context ->
            MediaRouteButton(context).apply {
                contentDescription = "Cast to a device"
                try {
                    CastContext.getSharedInstance(context)
                    CastButtonFactory.setUpMediaRouteButton(context, this)
                } catch (_: RuntimeException) {
                    // Devices without Google Play services retain ordinary phone playback.
                    isEnabled = false
                    contentDescription = "Casting requires Google Play services"
                }
            }
        }
    )
}
