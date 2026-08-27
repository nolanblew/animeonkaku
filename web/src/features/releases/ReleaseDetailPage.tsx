import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Disc3, Play, Shuffle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import type { MusicReleaseDto, MusicTrackDto } from '../../lib/library'
import { CatalogError, CatalogLoading } from '../catalog/CatalogError'
import './releases.css'

export interface ReleaseDetailPageProps {
  onPlayAll?: (release: MusicReleaseDto, shuffle: boolean) => void
  onPlayTrack?: (track: MusicTrackDto, release: MusicReleaseDto) => void
}

export function ReleaseDetailPage({ onPlayAll, onPlayTrack }: ReleaseDetailPageProps = {}) {
  const { releaseId } = useParams()
  const parsedReleaseId = parseReleaseId(releaseId)
  const query = useQuery<MusicReleaseDto>({
    queryKey: ['music-release', parsedReleaseId],
    enabled: parsedReleaseId !== null,
    queryFn: ({ signal }) => apiClient.get<MusicReleaseDto>(`/v1/music/releases/${encodeURIComponent(String(parsedReleaseId))}`, { signal }),
    staleTime: 60_000,
  })

  if (parsedReleaseId === null) {
    return <CatalogError title="Release unavailable" message="This release link is not valid." />
  }
  if (query.isError) {
    return <CatalogError title="Release unavailable" message="Could not load this release. Try again in a moment." error={query.error} onRetry={() => void query.refetch()} />
  }
  if (query.isPending || !query.data) return <CatalogLoading label="Loading release details" />

  const release = query.data
  const title = release.title.trim() || 'Untitled release'
  const artist = release.artistCredit.trim() || artistNames(release)
  const tracks = Array.isArray(release.tracks) ? release.tracks : []
  const artworkUrl = browserAssetUrl(release.artworkUrl)
  const sourceAnime = (release.anime ?? []).filter((anime) => anime.kitsuId && (anime.title || anime.titleEn))
  const releaseDate = release.releaseDate ? formatReleaseDate(release.releaseDate) : undefined
  const totalDuration = tracks.reduce((total, track) => total + (track.durationSeconds && Number.isFinite(track.durationSeconds) ? track.durationSeconds : 0), 0)

  return (
    <section className="page release-page" aria-labelledby="release-title">
      <Link className="catalog-back-link" to="/library"><ArrowLeft size={16} /> Back to library</Link>
      <header className="release-page__hero">
        <div className="release-page__artwork">
          {artworkUrl ? <img src={artworkUrl} alt={`${title} artwork`} /> : <span aria-hidden="true"><Disc3 size={64} /></span>}
        </div>
        <div className="release-page__copy">
          <p className="eyebrow">Music release</p>
          <h1 id="release-title">{title}</h1>
          <p className="release-page__artist">{artist}</p>
          <div className="release-page__facts" aria-label="Release metadata">
            {release.relationshipType && <span>{release.relationshipType}</span>}
            {release.year && <span><CalendarDays size={14} /> {release.year}</span>}
            {releaseDate && !release.year && <span><CalendarDays size={14} /> {releaseDate}</span>}
            <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
          </div>
          {sourceAnime.length > 0 && (
            <p className="release-page__source">Featured in {sourceAnime.map((anime, index) => <span key={anime.kitsuId}>{index > 0 && ', '}<Link to={`/anime/${encodeURIComponent(anime.kitsuId)}`}>{anime.title || anime.titleEn}</Link></span>)}</p>
          )}
          <div className="release-page__actions">
            <button className="button button--primary" type="button" disabled={!onPlayAll || tracks.length === 0} onClick={() => onPlayAll?.(release, false)}><Play size={17} fill="currentColor" /> Play all tracks</button>
            <button className="button button--secondary" type="button" disabled={!onPlayAll || tracks.length === 0} onClick={() => onPlayAll?.(release, true)}><Shuffle size={17} /> Shuffle release</button>
          </div>
        </div>
      </header>

      <section className="release-page__tracks" aria-labelledby="release-tracks-title">
        <div className="release-page__section-heading"><div><p className="eyebrow">Tracklist</p><h2 id="release-tracks-title">Tracks</h2></div><span>{tracks.length}</span></div>
        {tracks.length === 0
          ? <p className="catalog-empty">No ready tracks are available for this release yet.</p>
          : <ol className="release-track-list">{tracks.map((track, index) => <ReleaseTrackRow key={`${track.id}-${index}`} track={track} release={release} index={index} onPlay={onPlayTrack} />)}</ol>}
      </section>
    </section>
  )
}

function ReleaseTrackRow({ track, release, index, onPlay }: { track: MusicTrackDto; release: MusicReleaseDto; index: number; onPlay?: (track: MusicTrackDto, release: MusicReleaseDto) => void }) {
  const title = track.title.trim() || 'Untitled track'
  const artist = track.artistCredit.trim() || artistNames({ artistNames: track.artistNames } as MusicReleaseDto)
  return (
    <li className="release-track-list__row">
      <span className="release-track-list__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <button className="release-track-list__play" type="button" aria-label={`Play ${title}`} disabled={!onPlay} onClick={() => onPlay?.(track, release)}><Play size={15} fill="currentColor" /></button>
      <span className="release-track-list__copy"><strong>{title}</strong><small>{artist}</small></span>
      <span className="release-track-list__track-number">{track.trackNumber ?? '—'}</span>
      <time className="release-track-list__duration">{formatDuration(track.durationSeconds)}</time>
    </li>
  )
}

function parseReleaseId(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function artistNames(value: Pick<MusicReleaseDto, 'artistNames'>): string {
  const names = value.artistNames
    .map((artist) => artist.english || artist.romaji || artist.japanese || '')
    .map((artist) => artist.trim())
    .filter(Boolean)
  return names.join(', ') || 'Various artists'
}

function formatReleaseDate(value: string): string | undefined {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.valueOf())) return undefined
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
