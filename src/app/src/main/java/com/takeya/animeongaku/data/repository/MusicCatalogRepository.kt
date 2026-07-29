package com.takeya.animeongaku.data.repository

import com.takeya.animeongaku.data.local.AnimeEntity
import com.takeya.animeongaku.data.local.AnimeDao
import com.takeya.animeongaku.data.local.AnimeMusicReleaseEntity
import com.takeya.animeongaku.data.local.ArtistTrackCount
import com.takeya.animeongaku.data.local.MusicCatalogDao
import com.takeya.animeongaku.data.local.MusicReleaseEntity
import com.takeya.animeongaku.data.local.MusicReleaseSearchRow
import com.takeya.animeongaku.data.local.MusicReleaseWithRelationship
import com.takeya.animeongaku.data.local.MusicTrackRow
import com.takeya.animeongaku.data.local.MusicTrackSearchRow
import com.takeya.animeongaku.data.local.ReleaseTrackEntity
import com.takeya.animeongaku.data.local.SongEntity
import com.takeya.animeongaku.data.local.artistIdentity
import com.takeya.animeongaku.data.remote.OngakuMusicAnimeSummaryDto
import com.takeya.animeongaku.data.remote.OngakuMusicApi
import com.takeya.animeongaku.data.remote.OngakuMusicReleaseDto
import com.takeya.animeongaku.data.remote.OngakuMusicTrackDto
import com.takeya.animeongaku.data.remote.OngakuLocalizedNameDto
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

data class MusicOwner(val kitsuId: String, val title: String?, val artworkUrl: String?)

data class RelatedRelease(
    val release: MusicReleaseEntity,
    val relationshipType: String,
    val owner: MusicOwner,
    val tracks: List<RelatedTrack> = emptyList()
)

data class RelatedTrack(
    val song: SongEntity,
    val release: MusicReleaseEntity,
    val relationshipType: String,
    val owner: MusicOwner,
    val discNumber: Int = 1,
    val trackNumber: Int? = null,
    val displayOrder: Int = 0
) {
    fun asAnimeEntity(): AnimeEntity = AnimeEntity(
        kitsuId = owner.kitsuId,
        animeThemesId = null,
        title = owner.title,
        thumbnailUrl = owner.artworkUrl,
        coverUrl = owner.artworkUrl,
        syncedAt = 0L
    )
}

data class MusicSearchResults(
    val releases: List<RelatedRelease> = emptyList(),
    val tracks: List<RelatedTrack> = emptyList()
)

@Singleton
class MusicCatalogRepository @Inject constructor(
    private val dao: MusicCatalogDao,
    private val animeDao: AnimeDao,
    private val api: OngakuMusicApi
) {
    fun observeAnimeReleases(kitsuId: String, title: String? = null, artworkUrl: String? = null): Flow<List<RelatedRelease>> =
        dao.observeReleasesForAnime(kitsuId).map { rows ->
            rows.map { it.toDomain(MusicOwner(kitsuId, title, artworkUrl)) }
        }

    fun observeRelease(kitsuId: String, releaseId: Long, title: String? = null, artworkUrl: String? = null): Flow<RelatedRelease?> =
        combine(dao.observeRelease(releaseId), dao.observeReleaseTrackRows(releaseId), dao.observeReleasesForAnime(kitsuId)) {
                release, tracks, relationships ->
            val entity = release ?: return@combine null
            val relationship = relationships.firstOrNull { it.release.id == releaseId }?.relationshipType ?: return@combine null
            val owner = MusicOwner(kitsuId, title, artworkUrl)
            RelatedRelease(entity, relationship, owner, tracks.map { it.toDomain(entity, relationship, owner) })
        }

    fun searchCached(query: String): Flow<MusicSearchResults> =
        combine(dao.searchReleases(query.trim()), dao.searchTracks(query.trim())) { releases, tracks ->
            MusicSearchResults(releases.map(MusicReleaseSearchRow::toDomain), tracks.map(MusicTrackSearchRow::toDomain))
        }

    fun observeHomeTracks(): Flow<List<RelatedTrack>> =
        dao.observeHomeTracks().map { rows -> rows.map(MusicTrackSearchRow::toDomain) }

    fun observeArtistTrackCounts(): Flow<List<ArtistTrackCount>> = dao.observeCatalogArtistTrackCounts()

    fun observeArtistTracks(artistName: String): Flow<List<RelatedTrack>> {
        val target = artistIdentity(artistName)
        return dao.observeAllCatalogTracks().map { rows ->
            rows.filter { artistIdentity(it.song.artistCredit) == target || artistIdentity(it.releaseArtistCredit) == target }
                .map(MusicTrackSearchRow::toDomain)
        }
    }

    suspend fun refreshAnime(kitsuId: String): List<RelatedRelease> {
        val response = api.animeMusic(kitsuId)
        cache(response.releases, listOf(response.anime))
        val owner = response.anime.toOwner()
        return response.releases.map { it.toDomain(owner) }
    }

    suspend fun refreshRelease(kitsuId: String, releaseId: Long, fallbackOwner: MusicOwner): RelatedRelease {
        val dto = api.musicRelease(releaseId)
        val routeOwner = dto.anime.firstOrNull { it.kitsuId == kitsuId }
        val owners = dto.anime.ifEmpty {
            listOf(OngakuMusicAnimeSummaryDto(fallbackOwner.kitsuId, fallbackOwner.title, posterUrl = fallbackOwner.artworkUrl))
        }
        cache(listOf(dto), owners)
        return dto.toDomain(routeOwner?.toOwner() ?: fallbackOwner)
    }

    suspend fun searchRemote(query: String): MusicSearchResults {
        val music = api.search(query.trim()).music
        return MusicSearchResults(
            releases = music.releases.flatMap { result ->
                result.anime.map { owner -> result.release.toDomain(owner.toOwner(), owner.relationshipType ?: result.release.relationshipType) }
            },
            tracks = music.tracks.map { result ->
                val release = MusicReleaseEntity(result.releaseId, result.releaseTitle, result.track.artistCredit)
                result.track.toDomain(release, result.relationshipType ?: result.anime.relationshipType.orEmpty(), result.anime.toOwner())
            }
        )
    }

    private suspend fun cache(releases: List<OngakuMusicReleaseDto>, owners: List<OngakuMusicAnimeSummaryDto>) {
        if (releases.isEmpty()) return
        animeDao.upsertAll(owners.distinctBy { it.kitsuId }.map { owner ->
            animeDao.getByKitsuId(owner.kitsuId)?.copy(
                title = owner.title ?: animeDao.getByKitsuId(owner.kitsuId)?.title,
                titleEn = owner.titleEn ?: animeDao.getByKitsuId(owner.kitsuId)?.titleEn,
                thumbnailUrl = owner.posterUrl ?: animeDao.getByKitsuId(owner.kitsuId)?.thumbnailUrl,
                coverUrl = owner.posterUrl ?: animeDao.getByKitsuId(owner.kitsuId)?.coverUrl
            ) ?: AnimeEntity(owner.kitsuId, null, owner.title, owner.titleEn, thumbnailUrl = owner.posterUrl, coverUrl = owner.posterUrl, syncedAt = System.currentTimeMillis())
        })
        dao.upsertSongs(releases.flatMap { it.tracks }.distinctBy { it.id }.map(OngakuMusicTrackDto::toEntity))
        dao.upsertReleases(releases.map(OngakuMusicReleaseDto::toEntity))
        dao.upsertReleaseTracks(releases.flatMap { release -> release.tracks.map { it.toTrackEntity(release.id) } })
        dao.upsertAnimeReleases(releases.flatMap { release ->
            owners.map { owner -> AnimeMusicReleaseEntity(owner.kitsuId, release.id, owner.relationshipType ?: release.relationshipType) }
        })
    }
}

private fun MusicReleaseWithRelationship.toDomain(owner: MusicOwner) = RelatedRelease(release, relationshipType, owner)
private fun OngakuMusicAnimeSummaryDto.toOwner() = MusicOwner(kitsuId, titleEn ?: title, posterUrl)
internal fun OngakuMusicReleaseDto.toEntity() = MusicReleaseEntity(id, title, artistCredit, releaseDate, year, artworkUrl,
    titleEnglish, titleRomaji, titleJapanese, localizedArtistJson(artistNames))
internal fun OngakuMusicTrackDto.toEntity() = SongEntity(id, title, artistCredit, durationSeconds, audioUrl, fileSize,
    titleEnglish, titleRomaji, titleJapanese, localizedArtistJson(artistNames))
private fun localizedArtistJson(artists: List<OngakuLocalizedNameDto>): String = artists.joinToString(prefix = "[", postfix = "]") { artist ->
    "{\"english\":${jsonString(artist.english)},\"romaji\":${jsonString(artist.romaji)},\"japanese\":${jsonString(artist.japanese)}}"
}
private fun jsonString(value: String?): String = value?.let { "\"${it.replace("\\", "\\\\").replace("\"", "\\\"")}" } ?: "null"
private fun OngakuMusicTrackDto.toTrackEntity(releaseId: Long) = ReleaseTrackEntity(releaseId, id, discNumber, trackNumber, displayOrder)
private fun OngakuMusicReleaseDto.toDomain(owner: MusicOwner, relationship: String = relationshipType): RelatedRelease {
    val entity = toEntity()
    return RelatedRelease(entity, relationship, owner, tracks.map { it.toDomain(entity, relationship, owner) })
}
private fun OngakuMusicTrackDto.toDomain(release: MusicReleaseEntity, relationship: String, owner: MusicOwner) =
    RelatedTrack(toEntity(), release, relationship, owner, discNumber, trackNumber, displayOrder)
private fun MusicTrackRow.toDomain(release: MusicReleaseEntity, relationship: String, owner: MusicOwner) =
    RelatedTrack(song, release, relationship, owner, discNumber, trackNumber, displayOrder)
private fun MusicReleaseSearchRow.toDomain() = RelatedRelease(
    release, relationshipType, MusicOwner(ownerKitsuId, ownerTitle, ownerArtworkUrl)
)
private fun MusicTrackSearchRow.toDomain(): RelatedTrack {
    val release = MusicReleaseEntity(releaseId, releaseTitle, releaseArtistCredit, releaseDate, releaseYear, releaseArtworkUrl)
    return RelatedTrack(song, release, relationshipType, MusicOwner(ownerKitsuId, ownerTitle, ownerArtworkUrl), discNumber, trackNumber, displayOrder)
}
