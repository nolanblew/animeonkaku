import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Disc3, MoreHorizontal, Play, Shuffle } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import type { AnimeMusicDto, LibraryThemeDto, MusicTrackDto } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { ThemeActionSheet } from '../libraryactions'
import { AnimeCard } from './AnimeCard'
import { CatalogError, CatalogLoading } from './CatalogError'
import { displayTitle, statusLabel } from './selectors'
import type { AnimeDetailResponse } from './types'
import { browserAssetUrl } from '../../lib/assets'

export interface AnimeDetailPageProps {
  onPlayThemes?: (themes: LibraryThemeDto[], startIndex?: number, shuffle?: boolean, artworkUrl?: string | null) => void
  onPlayNext?: (themes: LibraryThemeDto[], artworkUrl?: string | null) => void
  onAddToQueue?: (themes: LibraryThemeDto[], artworkUrl?: string | null) => void
  onPlaySong?: (song: MusicTrackDto, artworkUrl: string | null, animeId: string) => void
}

export function AnimeDetailPage({ onPlayThemes, onPlayNext, onAddToQueue, onPlaySong }: AnimeDetailPageProps = {}) {
  const { animeId } = useParams()
  const libraryQuery = useLibraryQuery()
  const [actionThemes, setActionThemes] = useState<LibraryThemeDto[] | null>(null)
  const detail = useQuery<AnimeDetailResponse>({ queryKey: ['anime', animeId], enabled: Boolean(animeId), queryFn: ({ signal }) => apiClient.get<AnimeDetailResponse>(`/v1/anime/${encodeURIComponent(animeId!)}`, { signal }), staleTime: 60_000 })
  const music = useQuery<AnimeMusicDto>({ queryKey: ['anime-music', animeId], enabled: Boolean(animeId), queryFn: ({ signal }) => apiClient.get<AnimeMusicDto>(`/v1/anime/${encodeURIComponent(animeId!)}/music`, { signal }), staleTime: 60_000 })

  if (!animeId || detail.isError) return <CatalogError title="Anime unavailable" error={detail.error} />
  if (detail.isPending || !detail.data) return <CatalogLoading label="Loading anime details" />
  const anime = detail.data.anime
  const title = displayTitle(anime)
  const library = libraryQuery.library
  const animeInLibrary = Boolean(library?.animeById[anime.kitsuId] && !library.animeById[anime.kitsuId]?.deleted)
  const actionTheme = actionThemes?.[0]
  const actionPreference = actionTheme ? library?.prefsByThemeId[String(actionTheme.id)] : undefined
  const artworkUrl = browserAssetUrl(anime.posterUrl)
  const readyThemes = detail.data.themes.filter((theme) => theme.audioState === 'READY')
  return (
    <section className="page catalog-page catalog-detail" aria-labelledby="anime-title">
      <Link className="catalog-back-link" to="/library"><ArrowLeft size={16} /> Back to library</Link>
      <header className="catalog-detail__hero">{artworkUrl && <div className="catalog-detail__backdrop" data-testid="anime-hero-backdrop" style={{ backgroundImage: `url(${JSON.stringify(artworkUrl)})` }} aria-hidden="true" />}<div className="catalog-detail__poster">{artworkUrl ? <img src={artworkUrl} alt={`${title} poster`} /> : <span aria-hidden="true">AO</span>}</div><div className="catalog-detail__copy"><p className="eyebrow">Anime detail</p><h1 id="anime-title">{title}</h1>{anime.titleEn && anime.titleEn !== title && <p className="catalog-detail__alt-title">{anime.titleEn}</p>}<div className="catalog-detail__facts"><span>{statusLabel(anime.watchingStatus)}</span>{anime.subtype && <span>{anime.subtype}</span>}{anime.episodeCount && <span>{anime.episodeCount} episodes</span>}{anime.startDate && <span><CalendarDays size={14} /> {anime.startDate.slice(0, 4)}</span>}</div><div className="catalog-detail__genres">{anime.genres.slice(0, 5).map((genre) => <span key={genre}>{genre}</span>)}</div><div className="catalog-detail__actions"><button type="button" disabled={!onPlayThemes || readyThemes.length === 0} onClick={() => onPlayThemes?.(readyThemes, 0, false, anime.posterUrl)}><Play size={17} fill="currentColor" /> Play all</button><button type="button" disabled={!onPlayThemes || readyThemes.length === 0} onClick={() => onPlayThemes?.(readyThemes, 0, true, anime.posterUrl)}><Shuffle size={17} /> Shuffle</button><button type="button" disabled={detail.data.themes.length === 0} onClick={() => setActionThemes(detail.data.themes)}><MoreHorizontal size={17} /> More</button></div></div></header>
      <section className="catalog-section" aria-labelledby="anime-themes-title"><div className="catalog-section__heading"><div><p className="eyebrow">Openings and endings</p><h2 id="anime-themes-title">Themes</h2></div><span className="catalog-section__count">{detail.data.themes.length}</span></div>{detail.data.themes.length === 0 ? <p className="catalog-empty">No themes are available for this anime yet.</p> : <div className="catalog-theme-list">{detail.data.themes.map((theme) => { const startIndex = readyThemes.indexOf(theme); return <ThemeRow key={theme.id} theme={theme} onPlay={onPlayThemes && startIndex >= 0 ? () => onPlayThemes(readyThemes, startIndex, false, anime.posterUrl) : undefined} onMore={() => setActionThemes([theme])} /> })}</div>}</section>
      <section className="catalog-section" aria-labelledby="anime-music-title"><div className="catalog-section__heading"><div><p className="eyebrow">Ready catalog</p><h2 id="anime-music-title">Music releases</h2></div><Disc3 size={21} aria-hidden="true" /></div>{music.isError ? <CatalogError title="Music catalog unavailable" message="Themes are still available above. Try again later for album and track details." error={music.error} onRetry={() => void music.refetch()} /> : music.isPending ? <CatalogLoading label="Loading music releases" /> : music.data?.releases.length ? <div className="catalog-release-grid">{music.data.releases.map((release) => <article className="catalog-release-card" key={release.id}>{release.artworkUrl ? <img src={browserAssetUrl(release.artworkUrl)} alt="" loading="lazy" /> : <span className="catalog-release-card__art" aria-hidden="true"><Disc3 size={26} /></span>}<div><h3><Link to={`/release/${release.id}`}>{release.title}</Link></h3><p>{release.artistCredit || 'Various artists'}</p><small>{release.tracks.length} {release.tracks.length === 1 ? 'track' : 'tracks'}{release.year ? ` · ${release.year}` : ''}</small><ol className="catalog-release-tracks">{release.tracks.map((track) => <li key={track.id}><button type="button" disabled={!onPlaySong} onClick={() => onPlaySong?.(track, release.artworkUrl, anime.kitsuId)} aria-label={`Play ${track.title}`}><Play size={13} fill="currentColor" /><span>{track.title}</span><time>{formatDuration(track.durationSeconds)}</time></button></li>)}</ol></div></article>)}</div> : <p className="catalog-empty">No ready music releases are available for this anime yet.</p>}</section>
      {actionTheme && <ThemeActionSheet themeId={actionTheme.id} selectedThemeIds={actionThemes?.map((theme) => theme.id)} title={actionThemes && actionThemes.length > 1 ? title : actionTheme.title} subtitle={actionThemes && actionThemes.length > 1 ? `${actionThemes.length} themes` : [actionTheme.themeType, actionTheme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · ')} liked={actionPreference?.liked} disliked={actionPreference?.disliked} preferredMode={actionPreference?.preferredMode} hasFullSize={Boolean(actionTheme.mediaModes.fullSize)} inLibrary={Boolean(library?.themesById[String(actionTheme.id)] && !library.themesById[String(actionTheme.id)]?.deleted)} inAnimeLibrary={animeInLibrary} animeKitsuId={anime.kitsuId} animeThemesId={anime.animeThemesId ?? undefined} onPlay={onPlayThemes ? () => onPlayThemes(actionThemes ?? [actionTheme], 0, false, anime.posterUrl) : undefined} onPlayNext={onPlayNext ? () => onPlayNext(actionThemes ?? [actionTheme], anime.posterUrl) : undefined} onAddToQueue={onAddToQueue ? () => onAddToQueue(actionThemes ?? [actionTheme], anime.posterUrl) : undefined} onClose={() => setActionThemes(null)} />}
    </section>
  )
}

function ThemeRow({ theme, onPlay, onMore }: { theme: LibraryThemeDto; onPlay?: () => void; onMore: () => void }) {
  return <article className="catalog-theme-row"><button type="button" className="catalog-theme-row__art" onClick={onPlay} disabled={!onPlay || theme.audioState !== 'READY'} aria-label={`Play ${theme.title}`}><Play size={18} fill="currentColor" /></button><div><h3>{theme.title}</h3><p>{[theme.themeType, theme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · ') || 'Anime theme'}</p></div><span className="catalog-theme-row__state">{theme.audioState === 'READY' ? 'Ready' : theme.audioState.toLowerCase()}</span><button type="button" className="catalog-theme-row__more" onClick={onMore} aria-label={`More actions for ${theme.title}`}><MoreHorizontal size={18} /></button></article>
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
