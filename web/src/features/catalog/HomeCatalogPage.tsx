import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MoreHorizontal, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import type { LibraryThemeDto, NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { PlaylistArtwork, playlistArtworkUrls } from '../playlists'
import { AnimeCard } from './AnimeCard'
import { CatalogError, CatalogLoading } from './CatalogError'
import type { BrowserHomeResponse } from './types'

type HomeFilter = 'ALL' | 'OP' | 'ED' | 'FULL_SIZE' | 'TV_SIZE'

export interface HomeCatalogPageProps {
  onPlayTheme?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
}

const filters: Array<{ value: HomeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OP', label: 'Openings' },
  { value: 'ED', label: 'Endings' },
  { value: 'FULL_SIZE', label: 'Full size' },
  { value: 'TV_SIZE', label: 'TV size' },
]

export function HomeCatalogPage({ onPlayTheme }: HomeCatalogPageProps) {
  const home = useQuery<BrowserHomeResponse>({
    queryKey: ['home'],
    queryFn: ({ signal }) => apiClient.get<BrowserHomeResponse>('/v1/home?limit=24', { signal }),
    staleTime: 30_000,
    retry: 1,
  })
  const libraryQuery = useLibraryQuery()
  const [activeFilter, setActiveFilter] = useState<HomeFilter>('ALL')

  if (home.isPending) return <CatalogLoading label="Loading your home" />
  if (home.isError || !home.data) return <CatalogError title="Home unavailable" error={home.error} onRetry={() => void home.refetch()} />
  const data = home.data
  const library = libraryQuery.library
  const quickPicks = selectQuickPicks(data, library, activeFilter)
  const heroArtwork = quickPicks[0]?.artworkUrl ?? browserAssetUrl(data.continueWatching[0]?.posterUrl)

  return (
    <section className="page catalog-page home-catalog" aria-labelledby="home-title">
      <header className="home-hero">
        {heroArtwork && <div className="home-hero__backdrop" style={{ backgroundImage: `url(${JSON.stringify(heroArtwork)})` }} aria-hidden="true" />}
        <div className="home-hero__shade" aria-hidden="true" />
        <div className="home-hero__content">
          <p className="eyebrow">Your listening space</p>
          <h1 id="home-title">Welcome back</h1>
          <p>Anime music made from your Kitsu library—ready whenever you are.</p>
          <div className="home-filter-row" aria-label="Filter quick picks">
            {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={activeFilter === filter.value} onClick={() => setActiveFilter(filter.value)}>{filter.label}</button>)}
          </div>
        </div>
      </header>

      <section className="catalog-section home-quick-picks" aria-labelledby="quick-picks-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Made from your library</p><h2 id="quick-picks-title">Quick picks</h2><p>Play an opening, ending, or full song without leaving home.</p></div><Link to="/library?tab=songs" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        {quickPicks.length === 0
          ? <p className="catalog-empty">No tracks match this filter yet.</p>
          : <div className="home-quick-picks__grid">{quickPicks.map(({ theme, animeTitle, artworkUrl }) => (
            <article className="home-quick-pick" key={theme.id}>
              <button type="button" className="home-quick-pick__play" onClick={() => onPlayTheme?.(theme, artworkUrl)} disabled={!onPlayTheme || !isPlayable(theme)} aria-label={`Play ${theme.title}`}>
                {artworkUrl ? <img src={artworkUrl} alt="" /> : <span aria-hidden="true">AO</span>}<span className="home-quick-pick__play-icon"><Play size={18} fill="currentColor" /></span>
              </button>
              <span className="home-quick-pick__copy"><strong>{theme.title}</strong><small>{animeTitle} · {theme.themeType || 'Theme'}</small></span>
              <button type="button" className="home-quick-pick__more" aria-label={`More actions for ${theme.title}`}><MoreHorizontal size={19} /></button>
            </article>
          ))}</div>}
      </section>

      <section className="catalog-section" aria-labelledby="home-playlists-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Your collections</p><h2 id="home-playlists-title">Your playlists</h2></div><Link to="/playlists" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        {data.playlists.length === 0
          ? <p className="catalog-empty">Create a playlist to keep your favorite themes together.</p>
          : <div className="catalog-playlist-grid">{data.playlists.slice(0, 4).map((summary) => {
            const playlist = library?.playlistsById[String(summary.id)]
            return <Link className="catalog-playlist-card" to={`/playlist/${summary.id}`} key={summary.id} aria-label={`${summary.name}, ${summary.itemCount} tracks`}>
              <PlaylistArtwork playlistId={summary.id} name={summary.name} artworkUrls={playlistArtworkUrls(playlist, library)} />
              <span><strong>{summary.name}</strong><small>{summary.itemCount} {summary.itemCount === 1 ? 'track' : 'tracks'}{summary.isAuto ? ' · Auto' : ''}</small></span>
            </Link>
          })}</div>}
      </section>

      <RecentAnimeSection anime={data.recentlyAdded} library={library} />
    </section>
  )
}

function selectQuickPicks(data: BrowserHomeResponse, library: NormalizedLibrary | null, filter: HomeFilter) {
  if (!library) return []
  const priority = new Map(data.continueWatching.map((anime, index) => [anime.kitsuId, index]))
  return Object.values(library.themesById)
    .filter((theme) => !theme.deleted && theme.kitsuAnimeIds.some((id) => priority.has(id)))
    .filter((theme) => filter === 'ALL' || filter === 'OP' || filter === 'ED'
      ? filter === 'ALL' || (theme.themeType ?? '').toUpperCase().startsWith(filter)
      : filter === 'FULL_SIZE' ? Boolean(theme.mediaModes.fullSize) : Boolean(theme.mediaModes.tvSize))
    .sort((left, right) => Math.min(...left.kitsuAnimeIds.map((id) => priority.get(id) ?? 999)) - Math.min(...right.kitsuAnimeIds.map((id) => priority.get(id) ?? 999)) || left.id - right.id)
    .slice(0, 6)
    .map((theme) => {
      const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find(Boolean)
      return { theme, animeTitle: anime?.title ?? anime?.titleEn ?? 'Anime Ongaku', artworkUrl: browserAssetUrl(anime?.posterUrl ?? anime?.coverUrl) }
    })
}

function isPlayable(theme: LibraryThemeDto): boolean {
  return Boolean(theme.mediaModes.tvSize?.url || theme.mediaModes.fullSize?.url || theme.mediaModes.video?.url || theme.audioUrl)
}

function RecentAnimeSection({ anime, library }: { anime: BrowserHomeResponse['recentlyAdded']; library: NormalizedLibrary | null }) {
  const items = useMemo(() => anime.map((summary) => library?.animeById[summary.kitsuId] ?? { kitsuId: summary.kitsuId, title: summary.title, titleEn: summary.title, titleRomaji: null, titleJa: null, posterUrl: summary.posterUrl, watchingStatus: null, subtype: null, episodeCount: null, genres: [] }), [anime, library])
  return <section className="catalog-section home-recent" aria-labelledby="recently-added-title"><div className="catalog-section__heading"><div><p className="eyebrow">Fresh from Kitsu</p><h2 id="recently-added-title">Recently added</h2></div><Link to="/library" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>{items.length === 0 ? <p className="catalog-empty">Your next sync will fill this space.</p> : <div className="catalog-home-grid">{items.slice(0, 6).map((item) => <AnimeCard key={item.kitsuId} anime={item} themeCount={library ? Object.values(library.themesById).filter((theme) => !theme.deleted && theme.kitsuAnimeIds.includes(item.kitsuId)).length : undefined} />)}</div>}</section>
}
