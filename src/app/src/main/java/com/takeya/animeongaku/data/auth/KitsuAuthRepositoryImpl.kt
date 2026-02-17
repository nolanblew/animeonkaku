package com.takeya.animeongaku.data.auth

import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.takeya.animeongaku.data.remote.KitsuAuthApi
import com.takeya.animeongaku.data.remote.KitsuAuthError
import com.takeya.animeongaku.data.remote.KitsuAuthResponse
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton
import java.net.URLDecoder

@Singleton
class KitsuAuthRepositoryImpl @Inject constructor(
    private val authApi: KitsuAuthApi,
    private val tokenStore: KitsuTokenStore,
    moshi: Moshi
) : KitsuAuthRepository {
    private val errorAdapter = moshi.adapter(KitsuAuthError::class.java)
    private val authAdapter = moshi.adapter(KitsuAuthResponse::class.java)
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    override suspend fun login(username: String, password: String): KitsuToken {
        try {
            val response = authApi.login(
                grantType = "password",
                username = username,
                password = password,
                clientId = KITSU_CLIENT_ID,
                clientSecret = KITSU_CLIENT_SECRET
            )
            val token = response.parseToken()
            tokenStore.save(token)
            return token
        } catch (exception: HttpException) {
            val readable = toReadableError(exception)
            if (readable != null) {
                throw AuthException(readable, exception)
            }
            throw exception
        }
    }

    override suspend fun refreshIfNeeded(): KitsuToken? {
        val token = tokenStore.load() ?: return null
        if (!token.isExpired()) return token
        val refreshToken = token.refreshToken ?: return null
        val response = authApi.refresh(
            grantType = "refresh_token",
            refreshToken = refreshToken,
            clientId = KITSU_CLIENT_ID,
            clientSecret = KITSU_CLIENT_SECRET
        )
        val refreshed = response.parseToken()
        tokenStore.save(refreshed)
        return refreshed
    }

    override fun currentToken(): KitsuToken? = tokenStore.load()

    override fun clearToken() {
        tokenStore.clear()
    }

    fun toReadableError(exception: HttpException): String? {
        val body = exception.response()?.errorBody()?.string().orEmpty()
        val parsed = runCatching { errorAdapter.fromJson(body) }.getOrNull()
        return parsed?.errorDescription ?: parsed?.error
    }

    private fun retrofit2.Response<okhttp3.ResponseBody>.parseToken(): KitsuToken {
        val bodyString = if (isSuccessful) {
            body()?.string().orEmpty()
        } else {
            errorBody()?.string().orEmpty()
        }
        val trimmedBody = bodyString.trim()

        if (!isSuccessful) {
            val error = runCatching { errorAdapter.fromJson(bodyString) }.getOrNull()
            val message = error?.errorDescription ?: error?.error
            throw AuthException(message ?: "Kitsu auth failed (HTTP ${code()}).")
        }

        val parsed = runCatching { authAdapter.fromJson(trimmedBody) }.getOrNull()
        if (parsed != null && parsed.accessToken.isNotBlank()) {
            return parsed.toToken()
        }

        if (trimmedBody.isBlank()) {
            throw AuthException("Kitsu auth failed: empty response.")
        }
        if (trimmedBody.startsWith("<")) {
            throw AuthException("Kitsu auth failed: unexpected HTML response.")
        }

        val fallback = parseFallback(trimmedBody)
        val error = fallback.errorDescription ?: fallback.error
        if (error != null) {
            throw AuthException(error)
        }
        val accessToken = fallback.accessToken
            ?: throw AuthException("Kitsu auth failed: invalid response.")

        val nowSec = System.currentTimeMillis() / 1000
        val createdAt = fallback.createdAt ?: nowSec
        val expiresIn = fallback.expiresIn ?: 3600
        return KitsuToken(
            accessToken = accessToken,
            refreshToken = fallback.refreshToken,
            expiresAtMillis = (createdAt + expiresIn) * 1000
        )
    }

    private fun KitsuAuthResponse.toToken(): KitsuToken {
        val expiresAt = (createdAt + expiresIn) * 1000
        return KitsuToken(
            accessToken = accessToken,
            refreshToken = refreshToken,
            expiresAtMillis = expiresAt
        )
    }

    private data class FallbackAuth(
        val accessToken: String?,
        val refreshToken: String?,
        val expiresIn: Long?,
        val createdAt: Long?,
        val error: String?,
        val errorDescription: String?
    )

    private fun parseFallback(bodyString: String): FallbackAuth {
        val trimmed = bodyString.trim()
        val map = if (trimmed.startsWith("{")) {
            runCatching { mapAdapter.fromJson(trimmed) }.getOrNull().orEmpty()
        } else {
            parseFormEncoded(trimmed)
        }
        val apiError = extractError(map)
        return FallbackAuth(
            accessToken = map["access_token"].asString() ?: map["accessToken"].asString(),
            refreshToken = map["refresh_token"].asString() ?: map["refreshToken"].asString(),
            expiresIn = map["expires_in"].asLong() ?: map["expiresIn"].asLong(),
            createdAt = map["created_at"].asLong() ?: map["createdAt"].asLong(),
            error = map["error"].asString() ?: apiError,
            errorDescription = map["error_description"].asString()
        )
    }

    private fun parseFormEncoded(body: String): Map<String, Any?> {
        if (body.isBlank()) return emptyMap()
        return body.split("&")
            .mapNotNull { pair ->
                val index = pair.indexOf('=')
                if (index <= 0) return@mapNotNull null
                val key = URLDecoder.decode(pair.substring(0, index), "UTF-8")
                val value = URLDecoder.decode(pair.substring(index + 1), "UTF-8")
                key to value
            }
            .toMap()
    }

    private fun Any?.asString(): String? {
        return when (this) {
            is String -> this
            is Number -> toString()
            else -> null
        }
    }

    private fun Any?.asLong(): Long? {
        return when (this) {
            is Number -> toLong()
            is String -> toLongOrNull()
            else -> null
        }
    }

    private fun extractError(map: Map<String, Any?>): String? {
        val errors = map["errors"]
        if (errors is List<*>) {
            val first = errors.firstOrNull() as? Map<*, *> ?: return null
            val detail = first["detail"]?.toString()
            val title = first["title"]?.toString()
            return detail ?: title
        }
        return null
    }

    companion object {
        // Public client from Kitsu API docs.
        const val KITSU_CLIENT_ID =
            "dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd"
        const val KITSU_CLIENT_SECRET =
            "54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151"
    }
}

class AuthException(
    override val message: String,
    override val cause: Throwable? = null
) : Exception(message, cause)
