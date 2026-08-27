import { useQuery } from '@tanstack/react-query'
import { ArrowRight, MoreHorizontal, Play } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRovingMenu } from '../../components/focusScope'
import { apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import { readShowOstsOnHome, subscribeToHomePreference } from '../../lib/homePreference'
import type { LibraryThemeDto, NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { themePresentation } from '../../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference, type AnimeTitlePreference } from '../../lib/animeTitlePreference'
import { TrackActionMenu, useLibraryActions } from '../libraryactions'
import { playlistArtworkUrls } from '../playlists'
import { CatalogError, CatalogLoading } from './CatalogError'
import { CatalogPlaylistCard } from './CatalogPlaylistCard'
import type { BrowserHomeResponse, BrowserHomeTopSongSummary } from './types'

type HomeFilter = 'ALL' | 'OP' | 'ED'

export interface HomeCatalogPageProps {
  onPlayTheme?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onPlayAll?: (themes: LibraryThemeDto[], artworkUrl?: string | null) => void
  onPlayNext?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onAddToQueue?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onPlayPlaylist?: (playlist: NormalizedLibrary['playlistsById'][string]) => void
  onPlayNextPlaylist?: (playlist: NormalizedLibrary['playlistsById'][string]) => void
  onAddToQueuePlaylist?: (playlist: NormalizedLibrary['playlistsById'][string]) => void
}

const filters: Array<{ value: HomeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OP', label: 'Openings' },
  { value: 'ED', label: 'Endings' },
]

export function HomeCatalogPage({ onPlayTheme, onPlayAll, onPlayNext, onAddToQueue, onPlayPlaylist, onPlayNextPlaylist, onAddToQueuePlaylist }: HomeCatalogPageProps) {
  const home = useQuery<BrowserHomeResponse>({
    queryKey: ['home'],
    queryFn: ({ signal }) => apiClient.get<BrowserHomeResponse>('/v1/home?limit=24', { signal }),
    staleTime: 30_000,
    retry: 1,
  })
  const libraryQuery = useLibraryQuery()
  const [activeFilter, setActiveFilter] = useState<HomeFilter>('ALL')
  const showOstsOnHome = useSyncExternalStore(subscribeToHomePreference, readShowOstsOnHome, () => true)
  const animeTitlePreference = useAnimeTitlePreference()

  if (home.isPending) return <CatalogLoading label="Loading your home" />
  if (home.isError || !home.data) return <CatalogError title="Home unavailable" error={home.error} onRetry={() => void home.refetch()} />
  const data = home.data
  const library = libraryQuery.library
  const quickPicks = selectQuickPicks(data, library, activeFilter, showOstsOnHome, animeTitlePreference)
  const topSongs = selectTopSongs(data, library, showOstsOnHome, animeTitlePreference)
  const heroArtwork = quickPicks[0]?.artworkUrl ?? browserAssetUrl(data.continueWatching[0]?.posterUrl)
  const currentlyWatchingPlaylist = data.playlists.find((playlist) => playlist.name.trim().toLowerCase() === 'currently watching')

  return (
    <>
      <section className="page catalog-page home-catalog" aria-labelledby="home-title">
      <header className="home-hero">
        {heroArtwork && <div className="home-hero__backdrop" style={{ backgroundImage: `url(${JSON.stringify(heroArtwork)})` }} aria-hidden="true" />}
        <div className="home-hero__shade" aria-hidden="true" />
        <div className="home-hero__content">
          <p className="eyebrow">Made from your library</p>
          <h1 id="home-title">Your anime soundtrack</h1>
          <p>Openings and endings from the stories you are watching.</p>
          <div className="home-filter-row" aria-label="Filter recommendations">
            {filters.map((filter) => <button key={filter.value} type="button" aria-pressed={activeFilter === filter.value} onClick={() => setActiveFilter(filter.value)}>{filter.label}</button>)}
          </div>
        </div>
      </header>

      <section className="catalog-section home-quick-picks" aria-labelledby="quick-picks-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Picked for you</p><h2 id="quick-picks-title">Recommended</h2><p>Start with a theme from the anime in your library.</p></div><div className="catalog-section__actions"><button type="button" className="button button--text" onClick={() => onPlayAll?.(quickPicks.map(({ theme }) => theme), quickPicks[0]?.artworkUrl)} disabled={!onPlayAll || quickPicks.length === 0}>Play all</button><Link to="/library?tab=songs" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div></div>
        {quickPicks.length === 0
          ? <p className="catalog-empty">No tracks match this filter yet.</p>
          : <div className="home-quick-picks__grid">{quickPicks.map(({ theme, animeTitle, artworkUrl }) => (
            <article className="home-quick-pick" key={theme.id}>
              <button type="button" className="home-quick-pick__play" onClick={() => onPlayTheme?.(theme, artworkUrl)} disabled={!onPlayTheme || !isPlayable(theme)} aria-label={`Play ${theme.title}`}>
                {artworkUrl ? <img src={artworkUrl} alt="" /> : <span aria-hidden="true">AO</span>}<span className="home-quick-pick__play-icon"><Play size={18} fill="currentColor" /></span>
              </button>
              <ThemeCopy animeTitle={animeTitle} themeType={theme.themeType} songTitle={theme.title} artist={theme.artists.map((artist) => artist.name).join(', ')} className="home-quick-pick__copy" />
              <TrackActionMenu
                item={{ itemType: 'THEME', itemId: theme.id, title: theme.title }}
                menuOnly
                liked={library?.prefsByThemeId[String(theme.id)]?.liked}
                disliked={library?.prefsByThemeId[String(theme.id)]?.disliked}
                preferredMode={library?.prefsByThemeId[String(theme.id)]?.preferredMode}
                hasFullSize={Boolean(theme.mediaModes.fullSize)}
                onPlayNext={onPlayNext ? () => onPlayNext(theme, artworkUrl) : undefined}
                onAddToQueue={onAddToQueue ? () => onAddToQueue(theme, artworkUrl) : undefined}
              />
            </article>
          ))}</div>}
      </section>

      <section className="catalog-section home-top-songs" aria-labelledby="top-songs-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Most played from your library</p><h2 id="top-songs-title">Top songs</h2><p>Keep your most-loved themes close at hand.</p></div><Link to="/library?tab=songs" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        {topSongs.length === 0 ? <p className="catalog-empty">No top songs are available yet.</p> : <div className="home-top-songs__list">{topSongs.map((song) => {
          const artworkUrl = song.artworkUrl
          const theme = song.theme
          return <article className="home-top-song" key={song.id}>
            <button type="button" className="home-top-song__play" aria-label={`Play ${song.title}`} disabled={!onPlayTheme || !theme || !isPlayable(theme)} onClick={() => theme && onPlayTheme?.(theme, artworkUrl)}>
              {artworkUrl ? <img src={artworkUrl} alt="" loading="lazy" /> : <span aria-hidden="true">AO</span>}<Play size={16} fill="currentColor" />
            </button>
            <ThemeCopy animeTitle={song.animeTitle} themeType={theme?.themeType} songTitle={song.title} artist={song.artistName} className="home-top-song__copy" />
            {theme && <TrackActionMenu
              item={{ itemType: 'THEME', itemId: theme.id, title: song.title }}
              menuOnly
              liked={library?.prefsByThemeId[String(theme.id)]?.liked}
              disliked={library?.prefsByThemeId[String(theme.id)]?.disliked}
              preferredMode={library?.prefsByThemeId[String(theme.id)]?.preferredMode}
              hasFullSize={Boolean(theme.mediaModes.fullSize)}
              onPlayNext={onPlayNext ? () => onPlayNext(theme, artworkUrl) : undefined}
              onAddToQueue={onAddToQueue ? () => onAddToQueue(theme, artworkUrl) : undefined}
            />}
          </article>
        })}</div>}
      </section>

      <section className="catalog-section" aria-labelledby="home-playlists-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Your collections</p><h2 id="home-playlists-title">Your playlists</h2></div><Link to="/playlists" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        {data.playlists.length === 0
          ? <p className="catalog-empty">Create a playlist to keep your favorite themes together.</p>
          : <div className="catalog-playlist-grid">{data.playlists.slice(0, 4).map((summary) => {
            const playlist = library?.playlistsById[String(summary.id)]
            return <CatalogPlaylistCard key={summary.id} id={summary.id} name={summary.name} itemCount={summary.itemCount} isAuto={summary.isAuto} isDynamic={playlist?.isDynamic} artworkUrls={playlistArtworkUrls(playlist, library)} playlist={playlist} onPlay={onPlayPlaylist} onPlayNext={onPlayNextPlaylist} onAddToQueue={onAddToQueuePlaylist} />
          })}</div>}
      </section>

      {data.continueWatching.length > 0 && <section className="catalog-section home-currently-watching" aria-labelledby="currently-watching-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">From your Kitsu library</p><h2 id="currently-watching-title">Currently Watching</h2><p>Jump back into the themes from your active watchlist.</p></div><Link to={currentlyWatchingPlaylist ? `/playlist/${currentlyWatchingPlaylist.id}` : '/library'} className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        <div className="home-currently-watching__grid">{data.continueWatching.map((anime) => <HomeAnimeCard
          key={anime.kitsuId}
          anime={anime}
          libraryAnime={library?.animeById[anime.kitsuId]}
          themes={library ? Object.values(library.themesById).filter((theme) => !theme.deleted && theme.kitsuAnimeIds.includes(anime.kitsuId) && isPlayable(theme)) : []}
          playlistId={currentlyWatchingPlaylist?.id}
          onPlayAll={onPlayAll}
        />)}</div>
      </section>}

      </section>
    </>
  )
}

function ThemeCopy({ animeTitle, themeType, songTitle, artist, className }: { animeTitle?: string | null; themeType?: string | null; songTitle: string; artist?: string | null; className: string }) {
  const presentation = themePresentation({ animeTitle, themeType, songTitle, artist })
  return <span className={className}><strong>{presentation.primary}</strong><small>{presentation.secondary}</small></span>
}

function HomeAnimeCard({ anime, libraryAnime, themes, playlistId, onPlayAll }: {
  anime: BrowserHomeResponse['continueWatching'][number]
  libraryAnime?: NormalizedLibrary['animeById'][string]
  themes: LibraryThemeDto[]
  playlistId?: number
  onPlayAll?: HomeCatalogPageProps['onPlayAll']
}) {
  const [open, setOpen] = useState(false)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRovingMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef })
  const actions = useLibraryActions()
  const navigate = useNavigate()
  const animeTitlePreference = useAnimeTitlePreference()
  const title = preferredAnimeTitle(libraryAnime ?? anime, animeTitlePreference) || 'Untitled anime'
  const artworkUrl = browserAssetUrl(anime.posterUrl)
  const animePath = `/anime/${encodeURIComponent(anime.kitsuId)}`

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const remove = () => {
    if (!confirmingRemoval) { setConfirmingRemoval(true); return }
    setOpen(false)
    setConfirmingRemoval(false)
    void actions.removeAnimeFromLibrary(anime.kitsuId).catch(() => undefined)
  }

  return <article className="home-currently-watching__card" ref={rootRef}>
    <Link to={animePath} aria-label={title}>
      {artworkUrl ? <img src={artworkUrl} alt="" loading="lazy" /> : <span aria-hidden="true">AO</span>}
      <strong>{title}</strong>
      <small>Currently watching</small>
    </Link>
    <button ref={triggerRef} type="button" className="home-anime-actions__trigger" aria-label={`More actions for ${title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen((value) => !value); setConfirmingRemoval(false) }}><MoreHorizontal size={20} /></button>
    {open && <div ref={menuRef} className="home-anime-actions__menu track-actions__menu" role="menu" aria-label={`${title} actions`}>
      <button type="button" role="menuitem" onClick={() => navigate(animePath)}>Open anime</button>
      <button type="button" role="menuitem" disabled={!onPlayAll || themes.length === 0} onClick={() => { setOpen(false); onPlayAll?.(themes, artworkUrl) }}>Play all themes</button>
      {playlistId && <button type="button" role="menuitem" onClick={() => navigate(`/playlist/${playlistId}`)}>Open Currently Watching playlist</button>}
      <button type="button" role="menuitem" className="track-actions__danger" onClick={remove}>{confirmingRemoval ? 'Confirm remove from library' : 'Remove from library'}</button>
    </div>}
  </article>
}

function selectQuickPicks(data: BrowserHomeResponse, library: NormalizedLibrary | null, filter: HomeFilter, showOstsOnHome = true, titlePreference: AnimeTitlePreference = 'ENGLISH') {
  if (!library) return []
  const priority = new Map(data.continueWatching.map((anime, index) => [anime.kitsuId, index]))
  return Object.values(library.themesById)
    .filter((theme) => !theme.deleted && theme.kitsuAnimeIds.some((id) => priority.has(id)))
    .filter((theme) => showOstsOnHome || !isSoundtrackTheme(theme))
    .filter((theme) => filter === 'ALL' || (theme.themeType ?? '').toUpperCase().startsWith(filter))
    .sort((left, right) => Math.min(...left.kitsuAnimeIds.map((id) => priority.get(id) ?? 999)) - Math.min(...right.kitsuAnimeIds.map((id) => priority.get(id) ?? 999)) || left.id - right.id)
    .slice(0, 6)
    .map((theme) => {
      const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find(Boolean)
      return { theme, animeTitle: preferredAnimeTitle(anime, titlePreference) || 'Anime Ongaku', artworkUrl: themeArtworkFor(theme, library) }
    })
}

interface HomeTopSong {
  id: number
  title: string
  artistName: string | null
  animeTitle: string | null
  artworkUrl: string | null
  theme?: LibraryThemeDto
}

function selectTopSongs(data: BrowserHomeResponse, library: NormalizedLibrary | null, showOstsOnHome: boolean, titlePreference: AnimeTitlePreference = 'ENGLISH'): HomeTopSong[] {
  const summaries = data.topSongs
  if (summaries) return summaries
    .filter((summary) => showOstsOnHome || !isSoundtrackSummary(summary))
    .map((summary) => {
      const theme = library?.themesById[String(summary.id)]
      const artistName = summary.artistName ?? theme?.artists.map((artist) => artist.name).filter(Boolean).join(', ') ?? null
      return {
        id: summary.id,
        title: summary.title || theme?.title || 'Untitled song',
        artistName,
        animeTitle: theme ? (preferredAnimeTitle(theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find(Boolean), titlePreference) || summary.animeTitle || null) : summary.animeTitle ?? null,
        artworkUrl: browserAssetUrl(summary.artworkUrl) ?? (theme ? themeArtworkFor(theme, library) : null),
        theme,
      }
    })
  if (!library) return []
  return Object.values(library.themesById)
    .filter((theme) => !theme.deleted && isPlayable(theme) && (showOstsOnHome || !isSoundtrackTheme(theme)))
    .sort((left, right) => {
      const leftPreference = library.prefsByThemeId[String(left.id)]
      const rightPreference = library.prefsByThemeId[String(right.id)]
      return (rightPreference?.playCount ?? 0) - (leftPreference?.playCount ?? 0)
        || (rightPreference?.lastPlayedAt ?? 0) - (leftPreference?.lastPlayedAt ?? 0)
        || right.updatedAt - left.updatedAt
        || left.id - right.id
    })
    .slice(0, 10)
    .map((theme) => ({
      id: theme.id,
      title: theme.title,
      artistName: theme.artists.map((artist) => artist.name).filter(Boolean).join(', ') || null,
      animeTitle: preferredAnimeTitle(theme.kitsuAnimeIds.map((id) => library.animeById[id]).find(Boolean), titlePreference) || null,
      artworkUrl: themeArtworkFor(theme, library),
      theme,
    }))
}

function isSoundtrackSummary(summary: BrowserHomeTopSongSummary): boolean {
  return summary.relationshipType?.toUpperCase() === 'SOUNDTRACK'
}

function isSoundtrackTheme(theme: LibraryThemeDto): boolean {
  return /^(OST|SOUNDTRACK)\b/i.test(theme.themeType?.trim() ?? '')
}

function themeArtworkFor(theme: LibraryThemeDto, library: NormalizedLibrary | null): string | null {
  if (!library) return null
  const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find((entry) => entry && !entry.deleted)
  return browserAssetUrl(anime?.posterUrl ?? anime?.coverUrl) ?? null
}

function isPlayable(theme: LibraryThemeDto): boolean {
  return Boolean(theme.mediaModes.tvSize?.url || theme.mediaModes.fullSize?.url || theme.mediaModes.video?.url || theme.audioUrl)
}
