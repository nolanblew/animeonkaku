package com.takeya.animeongaku

import com.takeya.animeongaku.data.local.ArtistTrackCount
import com.takeya.animeongaku.data.local.artistIdentity
import com.takeya.animeongaku.data.local.mergeArtistTrackCounts
import org.junit.Assert.assertEquals
import org.junit.Test

class ArtistCatalogIdentityTest {
    @Test fun `reversed Latin name ordering is one artist`() {
        assertEquals(artistIdentity("Kevin Penkin"), artistIdentity("Penkin Kevin"))
        assertEquals(listOf(ArtistTrackCount("Kevin Penkin", 5)), mergeArtistTrackCounts(listOf(ArtistTrackCount("Kevin Penkin", 3), ArtistTrackCount("Penkin Kevin", 2))))
    }

    @Test fun `script variants are not guessed to be the same artist`() {
        assertEquals(false, artistIdentity("Kevin Penkin") == artistIdentity("ケビン・ペンキン"))
    }
}
