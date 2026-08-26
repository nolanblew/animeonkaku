import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Disc3, Play } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import type { AnimeMusicDto, LibraryThemeDto } from '../../lib/library'
import { AnimeCard } from './AnimeCard'
import { CatalogError, CatalogLoading } from './CatalogError'
import { displayTitle, statusLabel } from './selectors'
import type { AnimeDetailResponse } from './types'

export function AnimeDetailPage() {
  const { animeId } = useParams()
  const detail = useQuery<AnimeDetailResponse>({ queryKey: ['anime', animeId], enabled: Boolean(animeId), queryFn: ({ signal }) => apiClient.get<AnimeDetailResponse>(`/v1/anime/${encodeURIComponent(animeId!)}`, { signal }), staleTime: 60_000 })
  const music = useQuery<AnimeMusicDto>({ queryKey: ['anime-music', animeId], enabled: Boolean(animeId), queryFn: ({ signal }) => apiClient.get<AnimeMusicDto>(`/v1/anime/${encodeURIComponent(animeId!)}/music`, { signal }), staleTime: 60_000 })

  if (!animeId || detail.isError) return <CatalogError title="Anime unavailable" error={detail.error} />
  if (detail.isPending || !detail.data) return <CatalogLoading label="Loading anime details" />
  const anime = detail.data.anime
  const title = displayTitle(anime)
  return (
    <section className="page catalog-page catalog-detail" aria-labelledby="anime-title">
      <Link className="catalog-back-link" to="/library"><ArrowLeft size={16} /> Back to library</Link>
      <header className="catalog-detail__hero"><div className="catalog-detail__poster">{anime.posterUrl ? <img src={anime.posterUrl} alt={`${title} poster`} /> : <span aria-hidden="true">AO</span>}</div><div className="catalog-detail__copy"><p className="eyebrow">Anime detail</p><h1 id="anime-title">{title}</h1>{anime.titleEn && anime.titleEn !== title && <p className="catalog-detail__alt-title">{anime.titleEn}</p>}<div className="catalog-detail__facts"><span>{statusLabel(anime.watchingStatus)}</span>{anime.subtype && <span>{anime.subtype}</span>}{anime.episodeCount && <span>{anime.episodeCount} episodes</span>}{anime.startDate && <span><CalendarDays size={14} /> {anime.startDate.slice(0, 4)}</span>}</div><div className="catalog-detail__genres">{anime.genres.slice(0, 5).map((genre) => <span key={genre}>{genre}</span>)}</div></div></header>
      <section className="catalog-section" aria-labelledby="anime-themes-title"><div className="catalog-section__heading"><div><p className="eyebrow">Openings and endings</p><h2 id="anime-themes-title">Themes</h2></div><span className="catalog-section__count">{detail.data.themes.length}</span></div>{detail.data.themes.length === 0 ? <p className="catalog-empty">No themes are available for this anime yet.</p> : <div className="catalog-theme-list">{detail.data.themes.map((theme) => <ThemeRow key={theme.id} theme={theme} />)}</div>}</section>
      <section className="catalog-section" aria-labelledby="anime-music-title"><div className="catalog-section__heading"><div><p className="eyebrow">Ready catalog</p><h2 id="anime-music-title">Music releases</h2></div><Disc3 size={21} aria-hidden="true" /></div>{music.isError ? <CatalogError title="Music catalog unavailable" message="Themes are still available above. Try again later for album and track details." error={music.error} onRetry={() => void music.refetch()} /> : music.isPending ? <CatalogLoading label="Loading music releases" /> : music.data?.releases.length ? <div className="catalog-release-grid">{music.data.releases.map((release) => <article className="catalog-release-card" key={release.id}>{release.artworkUrl ? <img src={release.artworkUrl} alt="" loading="lazy" /> : <span className="catalog-release-card__art" aria-hidden="true"><Disc3 size={26} /></span>}<div><h3>{release.title}</h3><p>{release.artistCredit || 'Various artists'}</p><small>{release.tracks.length} {release.tracks.length === 1 ? 'track' : 'tracks'}{release.year ? ` · ${release.year}` : ''}</small></div></article>)}</div> : <p className="catalog-empty">No ready music releases are available for this anime yet.</p>}</section>
    </section>
  )
}

function ThemeRow({ theme }: { theme: LibraryThemeDto }) {
  return <article className="catalog-theme-row"><span className="catalog-theme-row__art" aria-hidden="true"><Play size={18} fill="currentColor" /></span><div><h3>{theme.title}</h3><p>{[theme.themeType, theme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · ') || 'Anime theme'}</p></div><span className="catalog-theme-row__state">{theme.audioState === 'READY' ? 'Ready' : theme.audioState.toLowerCase()}</span></article>
}
