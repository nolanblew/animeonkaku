package com.takeya.animeongaku

import com.takeya.animeongaku.media.AndroidAutoMediaId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AndroidAutoMediaIdTest {
    @Test
    fun parsesRootContainers() {
        assertEquals(AndroidAutoMediaId.Root, AndroidAutoMediaId.parse(AndroidAutoMediaId.ROOT))
        assertEquals(AndroidAutoMediaId.Home, AndroidAutoMediaId.parse(AndroidAutoMediaId.HOME))
        assertEquals(AndroidAutoMediaId.Playlists, AndroidAutoMediaId.parse(AndroidAutoMediaId.PLAYLISTS))
        assertEquals(AndroidAutoMediaId.Queue, AndroidAutoMediaId.parse(AndroidAutoMediaId.QUEUE))
    }

    @Test
    fun parsesPlaylistAndQueueIds() {
        assertEquals(AndroidAutoMediaId.Playlist(42), AndroidAutoMediaId.parse(AndroidAutoMediaId.playlist(42)))
        assertEquals(AndroidAutoMediaId.QueueEntry(7), AndroidAutoMediaId.parse(AndroidAutoMediaId.queueEntry(7)))
    }

    @Test
    fun parsesTrackContexts() {
        assertEquals(
            AndroidAutoMediaId.Track(
                AndroidAutoMediaId.homeQuickTrack(9),
                AndroidAutoMediaId.TrackContext.HOME_QUICK,
                9
            ),
            AndroidAutoMediaId.parse(AndroidAutoMediaId.homeQuickTrack(9))
        )
        assertEquals(
            AndroidAutoMediaId.Track(
                AndroidAutoMediaId.playlistTrack(3, 12),
                AndroidAutoMediaId.TrackContext.PLAYLIST(3),
                12
            ),
            AndroidAutoMediaId.parse(AndroidAutoMediaId.playlistTrack(3, 12))
        )
    }

    @Test
    fun rejectsMalformedIds() {
        assertNull(AndroidAutoMediaId.parse("theme:1"))
        assertNull(AndroidAutoMediaId.parse("ao:playlist:not-a-number"))
        assertNull(AndroidAutoMediaId.parse("ao:track:playlist:not-a-number:4"))
        assertNull(AndroidAutoMediaId.parse("ao:track:unknown:4"))
    }
}
