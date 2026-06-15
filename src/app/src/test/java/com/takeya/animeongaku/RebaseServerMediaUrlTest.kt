package com.takeya.animeongaku

import com.takeya.animeongaku.network.rebaseServerMediaUrl
import org.junit.Assert.assertEquals
import org.junit.Test

class RebaseServerMediaUrlTest {
    @Test
    fun `stale media host is rebased onto the current api-prefixed base`() {
        assertEquals(
            "http://192.168.1.50:8080/api/v1/media/audio/14197",
            rebaseServerMediaUrl(
                serverBaseUrl = "http://192.168.1.50:8080/api/",
                url = "http://127.0.0.1:8080/v1/media/audio/14197"
            )
        )
    }

    @Test
    fun `already-correct media url is rebased to the same value`() {
        assertEquals(
            "http://192.168.1.50:8080/api/v1/media/audio/14197",
            rebaseServerMediaUrl(
                serverBaseUrl = "http://192.168.1.50:8080/api/",
                url = "http://192.168.1.50:8080/api/v1/media/audio/14197"
            )
        )
    }

    @Test
    fun `base without api prefix keeps the media path`() {
        assertEquals(
            "http://host:8080/v1/media/images/anime/11/cover",
            rebaseServerMediaUrl(
                serverBaseUrl = "http://host:8080/",
                url = "http://127.0.0.1:8080/v1/media/images/anime/11/cover"
            )
        )
    }

    @Test
    fun `non-server-media urls are left untouched`() {
        assertEquals(
            "https://a.animethemes.moe/Toradora-OP1.ogg",
            rebaseServerMediaUrl(
                serverBaseUrl = "http://192.168.1.50:8080/api/",
                url = "https://a.animethemes.moe/Toradora-OP1.ogg"
            )
        )
    }

    @Test
    fun `blank base leaves the url untouched`() {
        assertEquals(
            "http://127.0.0.1:8080/v1/media/audio/14197",
            rebaseServerMediaUrl(
                serverBaseUrl = null,
                url = "http://127.0.0.1:8080/v1/media/audio/14197"
            )
        )
    }
}
