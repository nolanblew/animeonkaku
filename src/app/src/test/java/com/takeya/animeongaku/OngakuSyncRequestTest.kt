package com.takeya.animeongaku

import com.takeya.animeongaku.data.remote.OngakuSyncRequest
import org.junit.Assert.assertTrue
import org.junit.Test

class OngakuSyncRequestTest {
    @Test
    fun `manual sync request defaults to full reconciliation`() {
        assertTrue(OngakuSyncRequest().full)
    }
}
