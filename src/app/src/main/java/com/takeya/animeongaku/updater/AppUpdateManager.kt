package com.takeya.animeongaku.updater

import android.content.Context
import android.content.SharedPreferences
import com.squareup.moshi.Json
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

private const val UPDATE_PREFS_NAME = "app_update_prefs"
private const val KEY_LAST_CHECK_AT = "last_check_at"
private const val KEY_AVAILABLE_VERSION = "available_version"
private const val KEY_AVAILABLE_TAG = "available_tag"
private const val KEY_AVAILABLE_DOWNLOAD_URL = "available_download_url"
private const val KEY_AVAILABLE_RELEASE_URL = "available_release_url"
private const val KEY_AVAILABLE_PUBLISHED_AT = "available_published_at"
private const val KEY_AVAILABLE_NOTES = "available_notes"
private const val UPDATE_CHECK_INTERVAL_MS = 6L * 60L * 60L * 1000L
private const val GITHUB_RELEASES_API_URL = "https://api.github.com/repos/nolanblew/animeonkaku/releases/latest"
const val GITHUB_RELEASES_PAGE_URL = "https://github.com/nolanblew/animeonkaku/releases"
private const val APK_MIME_TYPE = "application/vnd.android.package-archive"

data class AvailableAppUpdate(
    val versionName: String,
    val versionTag: String,
    val downloadUrl: String,
    val releasePageUrl: String,
    val publishedAt: String? = null,
    val releaseNotes: String? = null
)

data class AppUpdateState(
    val enabled: Boolean,
    val isChecking: Boolean = false,
    val availableUpdate: AvailableAppUpdate? = null,
    val lastCheckedAt: Long = 0L
)

sealed interface UpdateCheckResult {
    data object Disabled : UpdateCheckResult
    data object NoUpdate : UpdateCheckResult
    data class UpdateAvailable(val update: AvailableAppUpdate) : UpdateCheckResult
    data class Failed(val message: String) : UpdateCheckResult
}

@Singleton
class AppUpdateManager @Inject constructor(
    @ApplicationContext context: Context,
    private val okHttpClient: OkHttpClient,
    moshi: Moshi
) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences(UPDATE_PREFS_NAME, Context.MODE_PRIVATE)
    private val releaseAdapter = moshi.adapter(GitHubReleaseDto::class.java)

    private val _state = MutableStateFlow(
        AppUpdateState(
            enabled = BuildConfig.UPDATER_ENABLED,
            availableUpdate = readCachedUpdate(),
            lastCheckedAt = prefs.getLong(KEY_LAST_CHECK_AT, 0L)
        )
    )
    val state: StateFlow<AppUpdateState> = _state.asStateFlow()

    suspend fun refreshIfNeeded() {
        if (!BuildConfig.UPDATER_ENABLED) return
        val now = System.currentTimeMillis()
        if (now - _state.value.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return
        runCheck()
    }

    suspend fun checkForUpdates(): UpdateCheckResult {
        if (!BuildConfig.UPDATER_ENABLED) {
            return UpdateCheckResult.Disabled
        }
        return runCheck()
    }

    private suspend fun runCheck(): UpdateCheckResult = withContext(Dispatchers.IO) {
        _state.update { it.copy(isChecking = true) }
        try {
            val checkedAt = System.currentTimeMillis()
            val latestRelease = fetchLatestRelease()
            return@withContext if (latestRelease != null && isNewerVersion(latestRelease.versionName, BuildConfig.VERSION_NAME)) {
                persistAvailableUpdate(latestRelease, checkedAt)
                _state.value = AppUpdateState(
                    enabled = true,
                    isChecking = false,
                    availableUpdate = latestRelease,
                    lastCheckedAt = checkedAt
                )
                UpdateCheckResult.UpdateAvailable(latestRelease)
            } else {
                clearAvailableUpdate(checkedAt)
                _state.value = AppUpdateState(
                    enabled = true,
                    isChecking = false,
                    availableUpdate = null,
                    lastCheckedAt = checkedAt
                )
                UpdateCheckResult.NoUpdate
            }
        } catch (error: Exception) {
            _state.update { it.copy(isChecking = false) }
            UpdateCheckResult.Failed(
                error.message?.takeIf(String::isNotBlank) ?: "Unable to check GitHub Releases right now."
            )
        }
    }

    private fun readCachedUpdate(): AvailableAppUpdate? {
        if (!BuildConfig.UPDATER_ENABLED) return null

        val versionName = prefs.getString(KEY_AVAILABLE_VERSION, null) ?: return null
        val versionTag = prefs.getString(KEY_AVAILABLE_TAG, null) ?: versionName
        val downloadUrl = prefs.getString(KEY_AVAILABLE_DOWNLOAD_URL, null) ?: return null
        val releasePageUrl = prefs.getString(KEY_AVAILABLE_RELEASE_URL, null) ?: GITHUB_RELEASES_PAGE_URL

        return AvailableAppUpdate(
            versionName = versionName,
            versionTag = versionTag,
            downloadUrl = downloadUrl,
            releasePageUrl = releasePageUrl,
            publishedAt = prefs.getString(KEY_AVAILABLE_PUBLISHED_AT, null),
            releaseNotes = prefs.getString(KEY_AVAILABLE_NOTES, null)
        ).takeIf { isNewerVersion(it.versionName, BuildConfig.VERSION_NAME) }
    }

    private fun persistAvailableUpdate(update: AvailableAppUpdate, checkedAt: Long) {
        prefs.edit()
            .putLong(KEY_LAST_CHECK_AT, checkedAt)
            .putString(KEY_AVAILABLE_VERSION, update.versionName)
            .putString(KEY_AVAILABLE_TAG, update.versionTag)
            .putString(KEY_AVAILABLE_DOWNLOAD_URL, update.downloadUrl)
            .putString(KEY_AVAILABLE_RELEASE_URL, update.releasePageUrl)
            .putString(KEY_AVAILABLE_PUBLISHED_AT, update.publishedAt)
            .putString(KEY_AVAILABLE_NOTES, update.releaseNotes)
            .apply()
    }

    private fun clearAvailableUpdate(checkedAt: Long) {
        prefs.edit()
            .putLong(KEY_LAST_CHECK_AT, checkedAt)
            .remove(KEY_AVAILABLE_VERSION)
            .remove(KEY_AVAILABLE_TAG)
            .remove(KEY_AVAILABLE_DOWNLOAD_URL)
            .remove(KEY_AVAILABLE_RELEASE_URL)
            .remove(KEY_AVAILABLE_PUBLISHED_AT)
            .remove(KEY_AVAILABLE_NOTES)
            .apply()
    }

    private fun fetchLatestRelease(): AvailableAppUpdate? {
        val request = Request.Builder()
            .url(GITHUB_RELEASES_API_URL)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "AnimeOngaku/${BuildConfig.VERSION_NAME}")
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("GitHub Releases returned ${response.code}.")
            }

            val payload = response.body?.string()
                ?: throw IOException("GitHub Releases returned an empty response.")
            val release = releaseAdapter.fromJson(payload)
                ?: throw IOException("GitHub Releases returned unreadable JSON.")

            return release.toAvailableAppUpdate()
        }
    }
}

internal data class GitHubReleaseDto(
    @Json(name = "tag_name") val tagName: String? = null,
    @Json(name = "name") val name: String? = null,
    @Json(name = "html_url") val htmlUrl: String? = null,
    @Json(name = "body") val body: String? = null,
    @Json(name = "published_at") val publishedAt: String? = null,
    @Json(name = "assets") val assets: List<GitHubReleaseAssetDto> = emptyList()
)

internal data class GitHubReleaseAssetDto(
    @Json(name = "name") val name: String? = null,
    @Json(name = "browser_download_url") val browserDownloadUrl: String? = null,
    @Json(name = "content_type") val contentType: String? = null
)

internal fun GitHubReleaseDto.toAvailableAppUpdate(): AvailableAppUpdate? {
    val versionSource = listOfNotNull(tagName, name).firstOrNull { it.isNotBlank() } ?: return null
    val versionName = extractVersionToken(versionSource) ?: return null
    val versionTag = tagName?.takeIf { it.isNotBlank() } ?: versionName
    val releasePageUrl = htmlUrl?.takeIf { it.isNotBlank() } ?: GITHUB_RELEASES_PAGE_URL
    val downloadUrl = selectPreferredApkAsset(assets)?.browserDownloadUrl?.takeIf { it.isNotBlank() }
        ?: releasePageUrl

    return AvailableAppUpdate(
        versionName = versionName,
        versionTag = versionTag,
        downloadUrl = downloadUrl,
        releasePageUrl = releasePageUrl,
        publishedAt = publishedAt,
        releaseNotes = body?.takeIf { it.isNotBlank() }
    )
}

internal fun selectPreferredApkAsset(assets: List<GitHubReleaseAssetDto>): GitHubReleaseAssetDto? {
    return assets
        .filter { asset ->
            val name = asset.name.orEmpty().lowercase()
            name.endsWith(".apk") || asset.contentType == APK_MIME_TYPE
        }
        .sortedWith(
            compareByDescending<GitHubReleaseAssetDto> { it.name.orEmpty().contains("release", ignoreCase = true) }
                .thenByDescending { it.name.orEmpty().contains("universal", ignoreCase = true) }
                .thenBy { it.name.orEmpty() }
        )
        .firstOrNull()
}

internal fun isNewerVersion(candidate: String, current: String): Boolean {
    return compareVersions(candidate, current) > 0
}

internal fun compareVersions(left: String, right: String): Int {
    val leftVersion = parseVersion(left)
    val rightVersion = parseVersion(right)
    val maxLength = maxOf(leftVersion.numbers.size, rightVersion.numbers.size)

    for (index in 0 until maxLength) {
        val leftPart = leftVersion.numbers.getOrElse(index) { 0 }
        val rightPart = rightVersion.numbers.getOrElse(index) { 0 }
        if (leftPart != rightPart) {
            return leftPart.compareTo(rightPart)
        }
    }

    return when {
        leftVersion.suffix == null && rightVersion.suffix != null -> 1
        leftVersion.suffix != null && rightVersion.suffix == null -> -1
        leftVersion.suffix == null && rightVersion.suffix == null -> 0
        else -> leftVersion.suffix.orEmpty().compareTo(rightVersion.suffix.orEmpty())
    }
}

private data class ParsedVersion(
    val numbers: List<Int>,
    val suffix: String?
)

private fun parseVersion(raw: String): ParsedVersion {
    val normalized = extractVersionToken(raw).orEmpty()
    val suffix = normalized.substringAfter('-', missingDelimiterValue = "").ifBlank { null }
    val numericPart = normalized.substringBefore('-')
    val numbers = numericPart
        .split('.')
        .mapNotNull { it.toIntOrNull() }

    return ParsedVersion(
        numbers = numbers.ifEmpty { listOf(0) },
        suffix = suffix
    )
}

internal fun extractVersionToken(raw: String?): String? {
    if (raw.isNullOrBlank()) return null

    val trimmed = raw.trim()
    val match = Regex("(\\d+(?:\\.\\d+)*(?:-[0-9A-Za-z.-]+)?)").find(trimmed)
    val version = match?.value ?: trimmed.removePrefix("v").removePrefix("V")
    return version.takeIf { it.isNotBlank() }
}
