package com.takeya.animeongaku

import com.takeya.animeongaku.network.toFriendReadableMessage
import java.net.ConnectException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class FriendReadableErrorsTest {
    @Test
    fun `bad credentials explain credential problem`() {
        val error = HttpException(Response.error<Unit>(401, "".toResponseBody(null)))

        assertEquals(
            "Sign-in failed: Kitsu did not accept those credentials. Check your email/username and password.",
            error.toFriendReadableMessage("Sign-in failed")
        )
    }

    @Test
    fun `connection failures point to server url and server availability`() {
        val message = ConnectException("Connection refused").toFriendReadableMessage("Server sync failed")

        assertTrue(message.contains("couldn't reach your Anime Ongaku server"))
        assertTrue(message.contains("server URL"))
    }
}