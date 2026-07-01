package com.takeya.animeongaku.network

import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import retrofit2.HttpException

fun Throwable.toFriendReadableMessage(action: String): String = when (this) {
    is HttpException -> when (code()) {
        401 -> "$action: Kitsu did not accept those credentials. Check your email/username and password."
        403 -> "$action: the server rejected this request. Check that your account has access."
        in 500..599 -> "$action: your Anime Ongaku server had a problem. Try again after the server is back up."
        else -> "$action: the server returned HTTP ${code()}. Check the server URL or try again."
    }
    is UnknownHostException,
    is ConnectException,
    is SocketTimeoutException -> "$action: couldn't reach your Anime Ongaku server. Check the server URL and that the server is running."
    is IOException -> "$action: network connection failed. Check Wi-Fi and the Anime Ongaku server URL."
    else -> message?.takeIf { it.isNotBlank() }?.let { "$action: $it" } ?: "$action. Please try again."
}
