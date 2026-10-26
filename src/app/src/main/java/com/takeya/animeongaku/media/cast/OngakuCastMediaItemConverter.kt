package com.takeya.animeongaku.media.cast

import android.os.Bundle
import androidx.media3.cast.DefaultMediaItemConverter
import androidx.media3.cast.MediaItemConverter
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import com.google.android.gms.cast.MediaQueueItem
import com.takeya.animeongaku.media.PlaybackMediaExtras
import org.json.JSONObject

@UnstableApi
internal class OngakuCastMediaItemConverter(private val audioUrl: (String) -> String) : MediaItemConverter {
    private val delegate = DefaultMediaItemConverter()
    private val originals = mutableMapOf<String, MediaItem>()

    override fun toMediaQueueItem(item: MediaItem): MediaQueueItem {
        val key = item.mediaMetadata.extras?.getString(PlaybackMediaExtras.MEDIA_KEY)
        val path = requireNotNull(castAudioPath(key)) { "Casting supports TV Size and Full Size audio. Choose an audio mode first." }
        originals[item.mediaId] = item
        val remote = item.buildUpon().setUri(audioUrl(path)).setMimeType("audio/mpeg").build()
        val queueItem = delegate.toMediaQueueItem(remote)
        val media = requireNotNull(queueItem.media)
        // Only portable metadata goes to the receiver. Phone file paths and auth tokens stay here.
        media.customData?.put("ongaku", JSONObject().apply {
            put("mediaKey", key)
            put("actualMode", item.mediaMetadata.extras?.getString(PlaybackMediaExtras.ACTUAL_MODE))
        })
        return queueItem
    }

    override fun toMediaItem(queueItem: MediaQueueItem): MediaItem {
        // The Default Media Receiver is shared by other apps. Its existing queue may not
        // contain Media3 customData; discovery/resume must not crash on that foreign media.
        if (queueItem.media?.customData?.optJSONObject("mediaItem") == null) {
            return MediaItem.Builder().setMediaId("external:${queueItem.itemId}").build()
        }
        val item = delegate.toMediaItem(queueItem)
        return originals[item.mediaId] ?: item.buildUpon().setMediaMetadata(
            item.mediaMetadata.buildUpon().setExtras(Bundle().apply {
                val custom = queueItem.media?.customData?.optJSONObject("ongaku")
                custom?.optString("mediaKey")?.let { putString(PlaybackMediaExtras.MEDIA_KEY, it) }
                custom?.optString("actualMode")?.let { putString(PlaybackMediaExtras.ACTUAL_MODE, it) }
            }).build()
        ).build()
    }
}
