package com.takeya.animeongaku.data.repository

import android.content.SharedPreferences
import com.squareup.moshi.Moshi
import com.takeya.animeongaku.data.auth.ServerTokenStore
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.ThemeDao
import com.takeya.animeongaku.data.local.ThemeEntity
import com.takeya.animeongaku.data.local.ThemeModeDao
import com.takeya.animeongaku.data.local.ThemeModeEntity
import com.takeya.animeongaku.data.local.UserPreferenceEntity
import com.takeya.animeongaku.data.remote.OngakuApi
import com.takeya.animeongaku.data.remote.OngakuMusicAnimeSummaryDto
import com.takeya.animeongaku.data.remote.OngakuMusicTrackDto
import com.takeya.animeongaku.data.remote.OngakuThemeDto
import com.takeya.animeongaku.data.remote.OngakuTopPickDto
import com.takeya.animeongaku.data.remote.OngakuTopPickReleaseDto
import com.takeya.animeongaku.data.remote.OngakuTopPicksResponse
import com.takeya.animeongaku.data.server.ServerSettingsStore
import com.takeya.animeongaku.media.PlayableItem
import com.takeya.animeongaku.sync.resolveServerUrl
import com.takeya.animeongaku.sync.toLoudnessProfile
import com.takeya.animeongaku.sync.toThemeEntity
import com.takeya.animeongaku.sync.toThemeModeEntity
import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class HomeTopPicksQuery(
    val includeExtras: Boolean,
    val filter: String
) {
    init {
        require(filter == FILTER_ALL || filter == FILTER_OP || filter == FILTER_ED)
    }

    private companion object {
        const val FILTER_ALL = "ALL"
        const val FILTER_OP = "OP"
        const val FILTER_ED = "ED"
    }
}

data class HomeTopPick(
    val key: String,
    val reason: String,
    val item: PlayableItem,
    val relatedTrack: RelatedTrack? = null
)

data class HomeTopPicksSnapshot(
    val query: HomeTopPicksQuery,
    val response: OngakuTopPicksResponse,
    val items: List<HomeTopPick>
)

internal fun isCompleteTopPicksResponse(response: OngakuTopPicksResponse, limit: Int): Boolean =
    response.total > 0 && response.items.size >= minOf(response.total, limit)

internal fun canRetainFullTopPicks(
    existing: OngakuTopPicksResponse?,
    preview: OngakuTopPicksResponse,
    fullLimit: Int
): Boolean = existing != null &&
    existing.snapshot == preview.snapshot &&
    existing.total == preview.total &&
    isCompleteTopPicksResponse(existing, fullLimit) &&
    preview.items.size <= existing.items.size &&
    preview.items.indices.all { index -> preview.items[index].key == existing.items[index].key }

internal fun mergeTopPicksPreview(
    existing: OngakuTopPicksResponse?,
    preview: OngakuTopPicksResponse,
    fullLimit: Int
): OngakuTopPicksResponse = if (canRetainFullTopPicks(existing, preview, fullLimit)) {
    checkNotNull(existing).copy(
        serverTime = preview.serverTime,
        generatedAt = preview.generatedAt,
        expiresAt = preview.expiresAt,
        total = preview.total,
        items = preview.items + existing.items.drop(preview.items.size)
    )
} else {
    preview
}

internal fun ThemeModeEntity.withReadyTopPickTvSize(audioState: String): ThemeModeEntity =
    if (audioState.equals("READY", ignoreCase = true)) this else copy(
        tvSizeUrl = "",
        tvSizeDurationSeconds = null,
        tvSizeFileSize = null,
        tvSizeLoudness = null
    )

/**
 * Loads the server's ordered Home recommendation snapshot. Room is used only to
 * preserve device-owned download paths and artwork overlays for matching items;
 * it never determines membership or order.
 */
@Singleton
class HomeTopPicksRepository @Inject constructor(
    private val api: OngakuApi,
    private val themeDao: ThemeDao,
    private val themeModeDao: ThemeModeDao,
    private val animeDao: AnimeDao,
    private val tokenStore: ServerTokenStore,
    private val serverSettingsStore: ServerSettingsStore,
    @Named("session") private val preferences: SharedPreferences,
    private val moshi: Moshi
) {
    private data class CacheIdentity(val userId: String, val serverBaseUrl: String)

    private val mutex = Mutex()
    private val responseAdapter by lazy { moshi.adapter(OngakuTopPicksResponse::class.java) }
    private val stringAdapter by lazy { moshi.adapter(String::class.java) }

    suspend fun cachedPreview(query: HomeTopPicksQuery): HomeTopPicksSnapshot? = mutex.withLock {
        val identity = currentIdentity() ?: return@withLock null
        read(query, identity)?.let { response ->
            if (currentIdentity() != identity) null else toSnapshot(query, response, identity)
        }
    }

    suspend fun refreshPreview(query: HomeTopPicksQuery): HomeTopPicksSnapshot? = mutex.withLock {
        val identity = currentIdentity() ?: return@withLock null
        val existing = read(query, identity)
        val response = request(query, limit = PREVIEW_LIMIT, snapshot = null)
        val body = response?.body()
        if (currentIdentity() != identity) return@withLock null
        if (body == null || !response.isSuccessful) return@withLock existing?.let {
            toSnapshot(query, it, identity)
        }
        val merged = mergePreview(existing, body)
        write(query, merged, identity)
        toSnapshot(query, merged, identity, freshItemKeys = body.items.mapTo(linkedSetOf()) { it.key })
            .takeIf { currentIdentity() == identity }
    }

    suspend fun full(query: HomeTopPicksQuery): HomeTopPicksSnapshot? = mutex.withLock {
        val identity = currentIdentity() ?: return@withLock null
        val existing = read(query, identity)
        val snapshot = existing?.snapshot
        val existingIsComplete = existing != null && isCompleteTopPicksResponse(existing, FULL_LIMIT)
        if (existingIsComplete && existing!!.expiresAt > System.currentTimeMillis()) {
            return@withLock toSnapshot(query, existing, identity).takeIf { currentIdentity() == identity }
        }

        val response = request(query, limit = FULL_LIMIT, snapshot = snapshot)
            ?: return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
        if (currentIdentity() != identity) return@withLock null
        if (response.code() == SNAPSHOT_EXPIRED) {
            val refreshed = request(query, limit = FULL_LIMIT, snapshot = null)
                ?: return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
            if (currentIdentity() != identity) return@withLock null
            val body = refreshed.body()
                ?: return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
            if (!refreshed.isSuccessful) return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
            write(query, body, identity)
            return@withLock toSnapshot(query, body, identity, freshItemKeys = body.items.mapTo(linkedSetOf()) { it.key })
                .takeIf { currentIdentity() == identity }
        }
        val body = response.body() ?: return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
        if (!response.isSuccessful) return@withLock existing?.takeIf { existingIsComplete }?.let { toSnapshot(query, it, identity) }
        write(query, body, identity)
        toSnapshot(query, body, identity, freshItemKeys = body.items.mapTo(linkedSetOf()) { it.key })
            .takeIf { currentIdentity() == identity }
    }

    private suspend fun request(
        query: HomeTopPicksQuery,
        limit: Int,
        snapshot: String?
    ) = try {
        api.topPicks(
            limit = limit,
            includeExtras = query.includeExtras,
            filter = query.filter,
            snapshot = snapshot
        )
    } catch (error: kotlinx.coroutines.CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

    private fun mergePreview(
        existing: OngakuTopPicksResponse?,
        preview: OngakuTopPicksResponse
    ): OngakuTopPicksResponse = mergeTopPicksPreview(existing, preview, FULL_LIMIT)

    private suspend fun toSnapshot(
        query: HomeTopPicksQuery,
        response: OngakuTopPicksResponse,
        identity: CacheIdentity,
        freshItemKeys: Set<String> = emptySet()
    ): HomeTopPicksSnapshot? {
        val serverBaseUrl = identity.serverBaseUrl
        val themeItems = response.items.filter { it.itemType == ITEM_THEME }
        val themeIds = themeItems.mapNotNull { it.theme?.id ?: it.itemId.takeIf { _ -> it.itemType == ITEM_THEME } }
        val existingThemes = if (themeIds.isEmpty()) emptyMap() else themeDao.getByIds(themeIds).associateBy { it.id }
        val existingModes = if (themeIds.isEmpty()) emptyMap() else themeModeDao.getByThemeIds(themeIds).associateBy { it.themeId }
        val kitsuIds = response.items.mapNotNull { it.anime?.kitsuId }.distinct()
        val existingAnime = if (kitsuIds.isEmpty()) emptyMap() else animeDao.getByKitsuIds(kitsuIds).associateBy { it.kitsuId }
        val mapped = response.items.mapNotNull { item ->
            when (item.itemType) {
                ITEM_THEME -> mapTheme(
                    item,
                    existingThemes,
                    existingModes,
                    existingAnime,
                    serverBaseUrl,
                    preferResponseMetadata = item.key in freshItemKeys
                )
                ITEM_SONG -> mapSong(item, existingAnime, serverBaseUrl)
                else -> null
            }
        }
        if (currentIdentity() != identity) return null
        return HomeTopPicksSnapshot(query, response, mapped)
    }

    private fun mapTheme(
        item: OngakuTopPickDto,
        existingThemes: Map<Long, ThemeEntity>,
        existingModes: Map<Long, ThemeModeEntity>,
        existingAnime: Map<String, AnimeEntity>,
        serverBaseUrl: String,
        preferResponseMetadata: Boolean
    ): HomeTopPick? {
        val dto = item.theme ?: return null
        val existing = existingThemes[dto.id]
        val theme = dto.toThemeEntity(serverBaseUrl, existing)
        val anime = item.anime?.let { summary ->
            topPickAnime(summary, dto.animeThemesAnimeId, existingAnime[summary.kitsuId], item.artworkUrl, serverBaseUrl)
        } ?: existingAnime.values.firstOrNull { it.animeThemesId == dto.animeThemesAnimeId }
        val mode = dto.toThemeModeEntity(serverBaseUrl).withReadyTopPickTvSize(dto.audioState)
        val preference = item.preference?.takeUnless { it.deleted }?.let { pref ->
            UserPreferenceEntity(
                themeId = dto.id,
                isLiked = pref.liked,
                isDisliked = pref.disliked,
                isDislikedTvSize = pref.dislikedTvSize,
                isDislikedFullSize = pref.dislikedFullSize,
                preferredMode = pref.preferredMode,
                updatedAt = pref.updatedAt,
                deletedAt = null
            )
        }
        return HomeTopPick(
            key = item.key.ifBlank { "$ITEM_THEME:${dto.id}" },
            reason = item.reason,
            item = PlayableItem.Theme(
                theme = theme,
                anime = anime,
                modeDescriptor = existingModes[dto.id],
                serverPreference = preference,
                remoteModeDescriptor = mode,
                // A live response owns playback until Room changes from the value observed
                // alongside it. Cached snapshots have no baseline and defer to current Room.
                roomModeDescriptorBaseline = existingModes[dto.id].takeIf { preferResponseMetadata }
            )
        )
    }

    private fun mapSong(
        item: OngakuTopPickDto,
        existingAnime: Map<String, AnimeEntity>,
        serverBaseUrl: String
    ): HomeTopPick? {
        val track = item.track ?: return null
        val releaseDto = item.release ?: return null
        val anime = item.anime?.let { summary -> topPickAnime(summary, null, existingAnime[summary.kitsuId], item.artworkUrl, serverBaseUrl) }
        val release = releaseDto.toEntity(serverBaseUrl)
        val song = track.toEntity(serverBaseUrl)
        val owner = MusicOwner(
            kitsuId = item.anime?.kitsuId.orEmpty(),
            title = item.anime?.titleEn ?: item.anime?.title,
            artworkUrl = anime?.coverUrl ?: anime?.thumbnailUrl ?: resolveServerUrl(serverBaseUrl, item.artworkUrl)
        )
        val related = RelatedTrack(
            song = song,
            release = release,
            relationshipType = releaseDto.relationshipType,
            owner = owner,
            discNumber = track.discNumber,
            trackNumber = track.trackNumber,
            displayOrder = track.displayOrder
        )
        return HomeTopPick(
            key = item.key.ifBlank { "$ITEM_SONG:${track.id}" },
            reason = item.reason,
            item = PlayableItem.RelatedSong(song, release, anime, releaseDto.relationshipType),
            relatedTrack = related
        )
    }

    private fun topPickAnime(
        summary: OngakuMusicAnimeSummaryDto,
        animeThemesId: Long?,
        existing: AnimeEntity?,
        fallbackArtworkUrl: String?,
        serverBaseUrl: String
    ): AnimeEntity {
        val poster = resolveServerUrl(serverBaseUrl, summary.posterUrl)
            ?: resolveServerUrl(serverBaseUrl, fallbackArtworkUrl)
        return existing?.copy(
            animeThemesId = existing.animeThemesId ?: animeThemesId,
            title = summary.title ?: existing.title,
            titleEn = summary.titleEn ?: existing.titleEn,
            thumbnailUrl = poster ?: existing.thumbnailUrl,
            thumbnailUrlLarge = poster ?: existing.thumbnailUrlLarge,
            coverUrl = poster ?: existing.coverUrl,
            coverUrlLarge = poster ?: existing.coverUrlLarge
        ) ?: AnimeEntity(
            kitsuId = summary.kitsuId,
            animeThemesId = animeThemesId,
            title = summary.title,
            titleEn = summary.titleEn,
            thumbnailUrl = poster,
            coverUrl = poster,
            syncedAt = 0L
        )
    }

    private fun OngakuTopPickReleaseDto.toEntity(baseUrl: String) = MusicReleaseEntity(
        id = id,
        title = title,
        artistCredit = artistCredit,
        releaseDate = releaseDate,
        year = year,
        artworkUrl = resolveServerUrl(baseUrl, artworkUrl),
        titleEnglish = titleEnglish,
        titleRomaji = titleRomaji,
        titleJapanese = titleJapanese,
        artistNamesJson = artistNames.joinToString(prefix = "[", postfix = "]") { artist ->
            "{\"english\":${jsonString(artist.english)},\"romaji\":${jsonString(artist.romaji)},\"japanese\":${jsonString(artist.japanese)}}"
        }
    )

    private fun OngakuMusicTrackDto.toEntity(baseUrl: String) = SongEntity(
        id = id,
        title = title,
        artistCredit = artistCredit,
        durationSeconds = durationSeconds,
        audioUrl = resolveServerUrl(baseUrl, audioUrl).orEmpty(),
        fileSize = fileSize,
        titleEnglish = titleEnglish,
        titleRomaji = titleRomaji,
        titleJapanese = titleJapanese,
        artistNamesJson = artistNames.joinToString(prefix = "[", postfix = "]") { artist ->
            "{\"english\":${jsonString(artist.english)},\"romaji\":${jsonString(artist.romaji)},\"japanese\":${jsonString(artist.japanese)}}"
        },
        loudness = loudness?.toLoudnessProfile()
    )

    private fun currentIdentity(): CacheIdentity? = tokenStore.currentSession()?.kitsuUserId?.let { userId ->
        CacheIdentity(userId, serverSettingsStore.serverBaseUrl.orEmpty().trim().trimEnd('/'))
    }

    private fun read(query: HomeTopPicksQuery, identity: CacheIdentity): OngakuTopPicksResponse? {
        val json = preferences.getString(cacheKey(identity, query), null) ?: return null
        return runCatching { responseAdapter.fromJson(json) }.getOrNull()
    }

    private fun write(query: HomeTopPicksQuery, response: OngakuTopPicksResponse, identity: CacheIdentity) {
        if (currentIdentity() != identity) return
        preferences.edit().putString(cacheKey(identity, query), responseAdapter.toJson(response)).apply()
    }

    private fun cacheKey(identity: CacheIdentity, query: HomeTopPicksQuery): String =
        "top_picks_${identity.serverBaseUrl}_${identity.userId}_${query.includeExtras}_${query.filter}"

    private fun jsonString(value: String?): String = value?.let(stringAdapter::toJson) ?: "null"

    private companion object {
        const val PREVIEW_LIMIT = 6
        const val FULL_LIMIT = 60
        const val SNAPSHOT_EXPIRED = 410
        const val ITEM_THEME = "THEME"
        const val ITEM_SONG = "SONG"
        const val FILTER_ALL = "ALL"
        const val FILTER_OP = "OP"
        const val FILTER_ED = "ED"
    }
}
