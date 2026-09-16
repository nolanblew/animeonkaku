import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MoreHorizontal, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccessibleFocusScope, useRovingMenu } from '../../components/focusScope'
import { ViewportMenu } from '../../components/ViewportMenu'
import { MediaListItem } from '../../components/MediaPresentation'
import { useAuth } from '../../auth/AuthProvider'
import { ApiError, apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import { artistRouteSlug } from '../../lib/navigation'
import { readShowOstsOnHome, subscribeToHomePreference } from '../../lib/homePreference'
import type { LibraryThemeDto, NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { themePresentation, type ThemePresentation } from '../../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference, type AnimeTitlePreference } from '../../lib/animeTitlePreference'
import { TrackActionMenu, useLibraryActions } from '../libraryactions'
import { playlistArtworkUrls } from '../playlists'
import { CatalogError, CatalogLoading } from './CatalogError'
import { CatalogPlaylistCard } from './CatalogPlaylistCard'
import type { BrowserHomeResponse, BrowserHomeTopSongSummary, BrowserTopPick, BrowserTopPicksResponse } from './types'

type HomeFilter = 'ALL' | 'OP' | 'ED'

export interface HomeCatalogPageProps {
  onPlayTheme?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onPlayAll?: (themes: LibraryThemeDto[], artworkUrl?: string | null) => void
  onPlayTopPick?: (pick: BrowserTopPick) => void
  onPlayTopPicks?: (picks: BrowserTopPick[]) => void
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

export function HomeCatalogPage({ onPlayTheme, onPlayAll, onPlayTopPick, onPlayTopPicks, onPlayNext, onAddToQueue, onPlayPlaylist, onPlayNextPlaylist, onAddToQueuePlaylist }: HomeCatalogPageProps) {
  const navigate = useNavigate()
  const auth = useAuth()
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
  const queryClient = useQueryClient()
  const topPicksScope = `${activeFilter}:${showOstsOnHome ? 'extras' : 'themes'}`
  const topPicksQuery = useQuery<BrowserTopPicksResponse>({
    queryKey: ['top-picks', auth.user?.kitsuUserId ?? 'anonymous', topPicksScope],
    queryFn: ({ signal }) => apiClient.get<BrowserTopPicksResponse>(topPicksPath(6, activeFilter, showOstsOnHome), { signal }),
    enabled: auth.status === 'authenticated',
    staleTime: 30 * 60_000,
    retry: 1,
  })
  const libraryThemeCount = libraryQuery.library ? Object.values(libraryQuery.library.themesById).filter((theme) => !theme.deleted).length : 0
  const emptyRetryKey = `${topPicksScope}:${libraryQuery.library?.cursor ?? 'none'}:${libraryThemeCount}`
  const emptyRetryKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (auth.status !== 'authenticated' || libraryThemeCount === 0 || topPicksQuery.data?.items?.length !== 0 || emptyRetryKeyRef.current === emptyRetryKey) return
    emptyRetryKeyRef.current = emptyRetryKey
    void topPicksQuery.refetch()
  }, [auth.status, emptyRetryKey, libraryThemeCount, topPicksQuery.data?.items?.length, topPicksQuery.refetch])
  const [previewOverride, setPreviewOverride] = useState<BrowserTopPicksResponse | null>(null)
  const [fullTopPicks, setFullTopPicks] = useState<BrowserTopPicksResponse | null>(null)
  const [fullTopPicksScope, setFullTopPicksScope] = useState<string | null>(null)
  const [fullTopPicksSnapshot, setFullTopPicksSnapshot] = useState<string | null>(null)
  const [showAllTopPicks, setShowAllTopPicks] = useState(false)
  const [fullTopPicksLoading, setFullTopPicksLoading] = useState(false)
  const [fullTopPicksError, setFullTopPicksError] = useState<unknown>(null)
  const fullTopPicksGeneration = useRef(0)
  const fullTopPicksAbort = useRef<AbortController | null>(null)
  const seeAllTopPicksRef = useRef<HTMLButtonElement>(null)
  const closeTopPicksDialogRef = useRef<HTMLButtonElement>(null)
  const topPicksDialogRef = useAccessibleFocusScope<HTMLDivElement>({
    active: showAllTopPicks,
    onEscape: () => setShowAllTopPicks(false),
    restoreFocusRef: seeAllTopPicksRef,
    initialFocusRef: closeTopPicksDialogRef,
  })
  useEffect(() => {
    fullTopPicksGeneration.current += 1
    fullTopPicksAbort.current?.abort()
    fullTopPicksAbort.current = null
    setFullTopPicksLoading(false)
    setPreviewOverride(null)
    setFullTopPicks(null)
    setFullTopPicksScope(null)
    setFullTopPicksSnapshot(null)
    setShowAllTopPicks(false)
    setFullTopPicksError(null)
    return () => {
      fullTopPicksGeneration.current += 1
      fullTopPicksAbort.current?.abort()
      fullTopPicksAbort.current = null
    }
  }, [activeFilter, auth.user?.kitsuUserId, showOstsOnHome])

  const loadFullTopPicks = useCallback(async (playAfterLoad = false) => {
    const preview = previewOverride ?? topPicksQuery.data
    if (!preview || fullTopPicksLoading) return
    const fullIsReusable = fullTopPicksScope === topPicksScope
      && fullTopPicksSnapshot === preview.snapshot
      && fullTopPicks
      && fullTopPicks.expiresAt > Date.now()
    if (fullIsReusable) {
      if (!playAfterLoad) setShowAllTopPicks(true)
      if (playAfterLoad) onPlayTopPicks?.(fullTopPicks.items)
      return
    }
    if (!playAfterLoad) setShowAllTopPicks(true)
    const generation = ++fullTopPicksGeneration.current
    fullTopPicksAbort.current?.abort()
    const controller = new AbortController()
    fullTopPicksAbort.current = controller
    setFullTopPicksLoading(true)
    setFullTopPicksError(null)
    try {
      let response: BrowserTopPicksResponse
      try {
        response = await apiClient.get<BrowserTopPicksResponse>(topPicksPath(60, activeFilter, showOstsOnHome, preview.snapshot), { signal: controller.signal })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 410) throw error
        const latestPreview = await apiClient.get<BrowserTopPicksResponse>(topPicksPath(6, activeFilter, showOstsOnHome), { signal: controller.signal })
        if (generation !== fullTopPicksGeneration.current) return
        setPreviewOverride(latestPreview)
        queryClient.setQueryData(['top-picks', auth.user?.kitsuUserId ?? 'anonymous', topPicksScope], latestPreview)
        response = await apiClient.get<BrowserTopPicksResponse>(topPicksPath(60, activeFilter, showOstsOnHome, latestPreview.snapshot), { signal: controller.signal })
      }
      if (generation !== fullTopPicksGeneration.current) return
      setFullTopPicks(response)
      setFullTopPicksScope(topPicksScope)
      setFullTopPicksSnapshot(response.snapshot)
      if (playAfterLoad) onPlayTopPicks?.(response.items)
    } catch (error) {
      if (generation !== fullTopPicksGeneration.current || controller.signal.aborted) return
      setFullTopPicksError(error)
    } finally {
      if (generation === fullTopPicksGeneration.current) {
        setFullTopPicksLoading(false)
        if (fullTopPicksAbort.current === controller) fullTopPicksAbort.current = null
      }
    }
  }, [activeFilter, auth.user?.kitsuUserId, fullTopPicks, fullTopPicksLoading, fullTopPicksScope, fullTopPicksSnapshot, onPlayTopPicks, previewOverride, queryClient, showOstsOnHome, topPicksQuery.data, topPicksScope])

  if (home.isPending) return <CatalogLoading label="Loading your home" />
  if (home.isError || !home.data) return <CatalogError title="Home unavailable" error={home.error} onRetry={() => void home.refetch()} />
  const data = home.data
  const library = libraryQuery.library
  const previewTopPicks = previewOverride ?? topPicksQuery.data
  const topPicks = previewTopPicks
  const expandedTopPicks = fullTopPicksScope === topPicksScope && fullTopPicks ? fullTopPicks : null
  const topPickItems = Array.isArray(topPicks?.items) ? topPicks.items : []
  const topSongs = selectTopSongs(data, library, showOstsOnHome, animeTitlePreference)
  const heroArtwork = topPickItems[0]?.artworkUrl ?? browserAssetUrl(data.continueWatching[0]?.posterUrl)
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

      <section className="catalog-section home-quick-picks" aria-labelledby="top-picks-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Picked for you</p><h2 id="top-picks-title">Top picks</h2><p>Favorites, most-played themes, and a few discoveries from your library.</p></div><div className="catalog-section__actions">
          <button type="button" className="button button--primary" onClick={() => void loadFullTopPicks(true)} disabled={!topPicks || fullTopPicksLoading || !onPlayTopPicks}>Play</button>
          <button ref={seeAllTopPicksRef} type="button" className="catalog-section__link" onClick={() => void loadFullTopPicks(false)} disabled={!topPicks || fullTopPicksLoading} aria-expanded={showAllTopPicks}>See all <ArrowRight size={15} /></button>
        </div></div>
        {topPicksQuery.isPending && !topPicks
          ? <p className="catalog-empty">Loading your top picks…</p>
          : !topPicks
            ? <p className="catalog-empty">Top picks are unavailable right now. <button type="button" className="button button--text" onClick={() => void topPicksQuery.refetch()}>Try again</button></p>
            : topPickItems.length === 0
              ? <p className="catalog-empty">No tracks match this filter yet.</p>
              : <div className="home-quick-picks__grid">{topPickItems.map((pick) => <HomeTopPickCard key={pick.key} pick={pick} library={library} animeTitlePreference={animeTitlePreference} onPlay={onPlayTopPick} onPlayTheme={onPlayTheme} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} navigate={navigate} />)}</div>}
        {fullTopPicksLoading && <p className="catalog-inline-status">Loading the full top picks set…</p>}
        {Boolean(fullTopPicksError) && !fullTopPicksLoading && !showAllTopPicks && <p className="catalog-empty">Could not load the full top picks set. <button type="button" className="button button--text" onClick={() => void loadFullTopPicks(false)}>Try again</button></p>}
      </section>

      {showAllTopPicks && <section ref={topPicksDialogRef} className="home-top-picks-dialog" role="dialog" aria-modal="true" aria-labelledby="top-picks-dialog-title" onPointerDown={(event) => { if (event.target === event.currentTarget) event.preventDefault() }}>
        <div className="home-top-picks-dialog__panel">
          <header className="catalog-section__heading">
            <div><p className="eyebrow">Expanded collection</p><h2 id="top-picks-dialog-title">Top picks</h2><p>{expandedTopPicks?.total ?? 0} tracks selected for you.</p></div>
            <div className="catalog-section__actions">
              <button type="button" className="button button--primary" onClick={() => void loadFullTopPicks(true)} disabled={fullTopPicksLoading || !onPlayTopPicks || !expandedTopPicks}>Play</button>
              <button ref={closeTopPicksDialogRef} type="button" className="button button--text" onClick={() => setShowAllTopPicks(false)}>Back to preview</button>
            </div>
          </header>
          {fullTopPicksLoading && <p className="catalog-empty">Loading the full top picks set…</p>}
          {Boolean(fullTopPicksError) && !fullTopPicksLoading && <p className="catalog-empty">Could not load the full top picks set. <button type="button" className="button button--text" onClick={() => void loadFullTopPicks(false)}>Try again</button></p>}
          {expandedTopPicks && !fullTopPicksLoading && <div className="home-quick-picks__grid">{expandedTopPicks.items.map((pick) => <HomeTopPickCard key={pick.key} pick={pick} library={library} animeTitlePreference={animeTitlePreference} onPlay={onPlayTopPick} onPlayTheme={onPlayTheme} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} navigate={navigate} />)}</div>}
        </div>
      </section>}

      <section className="catalog-section home-top-songs" aria-labelledby="top-songs-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Most played from your library</p><h2 id="top-songs-title">Top songs</h2><p>Keep your most-loved themes close at hand.</p></div><Link to="/library?tab=songs" className="catalog-section__link">See all <ArrowRight size={15} /></Link></div>
        {topSongs.length === 0 ? <p className="catalog-empty">No top songs are available yet.</p> : <div className="home-top-songs__list">{topSongs.map((song) => {
          const artworkUrl = song.artworkUrl
          const theme = song.theme
          const presentation = themePresentation({ animeTitle: song.animeTitle, themeType: theme?.themeType, songTitle: song.title, artist: song.artistName })
          const destination = theme ? themeDestinations(theme, library) : null
          return <MediaListItem element="article" className="home-top-song" key={song.id}
            artwork={<button type="button" className="home-top-song__play" aria-label={`Play ${song.title}`} disabled={!onPlayTheme || !theme || !isPlayable(theme)} onClick={() => theme && onPlayTheme?.(theme, artworkUrl)}>
              {artworkUrl ? <img src={artworkUrl} alt="" loading="lazy" /> : <span aria-hidden="true">AO</span>}<Play size={16} fill="currentColor" />
            </button>}
            title={<HomeThemeIdentity animeTitle={song.animeTitle} presentation={presentation} />}
            subtitle={presentation.secondary}
            actions={theme && <TrackActionMenu
              item={{ itemType: 'THEME', itemId: theme.id, title: song.title }}
              menuOnly
              liked={library?.prefsByThemeId[String(theme.id)]?.liked}
              disliked={library?.prefsByThemeId[String(theme.id)]?.disliked}
              preferredMode={library?.prefsByThemeId[String(theme.id)]?.preferredMode}
              hasFullSize={Boolean(theme.mediaModes.fullSize)}
              onPlayNext={onPlayNext ? () => onPlayNext(theme, artworkUrl) : undefined}
              onAddToQueue={onAddToQueue ? () => onAddToQueue(theme, artworkUrl) : undefined}
              onGoToArtist={destination?.artistSlug ? () => navigate(`/artist/${encodeURIComponent(destination.artistSlug!)}`) : undefined}
              artistName={destination?.artistName}
              onGoToAnime={destination?.animeId ? () => navigate(`/anime/${encodeURIComponent(destination.animeId!)}`) : undefined}
              animeName={destination?.animeName}
            />}
          />
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

function HomeThemeIdentity({ animeTitle, presentation }: { animeTitle?: string | null; presentation: ThemePresentation }) {
  const normalizedAnimeTitle = animeTitle?.trim()
  if (!normalizedAnimeTitle || !presentation.typeLabel) return presentation.primary

  return <span className="home-theme-identity">
    <span className="home-theme-identity__type">{presentation.typeLabel}</span>
    <span className="home-theme-identity__anime" title={normalizedAnimeTitle}>{normalizedAnimeTitle}</span>
  </span>
}

function HomeTopPickCard({ pick, library, animeTitlePreference, onPlay, onPlayTheme, onPlayNext, onAddToQueue, navigate }: {
  pick: BrowserTopPick
  library: NormalizedLibrary | null
  animeTitlePreference: AnimeTitlePreference
  onPlay?: (pick: BrowserTopPick) => void
  onPlayTheme?: HomeCatalogPageProps['onPlayTheme']
  onPlayNext?: HomeCatalogPageProps['onPlayNext']
  onAddToQueue?: HomeCatalogPageProps['onAddToQueue']
  navigate: (to: string) => void
}) {
  const animeTitle = preferredAnimeTitle(pick.anime, animeTitlePreference) || pick.anime?.title || null
  const isTheme = pick.itemType === 'THEME'
  const title = isTheme ? pick.theme.title : pick.track.title
  const artist = isTheme
    ? pick.theme.artists.map((entry) => entry.name).filter(Boolean).join(', ')
    : pick.track.artistCredit
  const themeType = isTheme ? pick.theme.themeType : pick.release.relationshipType
  const presentation = themePresentation({ animeTitle, themeType, songTitle: title, artist })
  const artworkUrl = browserAssetUrl(pick.artworkUrl) ?? browserAssetUrl(pick.anime?.posterUrl)
  const playable = isTheme ? isPlayable(pick.theme) : Boolean(pick.track.audioUrl)
  const theme = isTheme ? pick.theme : undefined
  const destination = theme ? themeDestinations(theme, library) : null
  const preference = pick.itemType === 'THEME' ? (pick.preference ?? library?.prefsByThemeId[String(pick.theme.id)]) : undefined
  const safeDestination = destination ?? { artistSlug: null, artistName: null, animeId: null, animeName: null }
  const play = onPlay ? () => onPlay(pick) : theme && onPlayTheme ? () => onPlayTheme(theme, artworkUrl) : undefined

  return <MediaListItem element="article" className="home-quick-pick"
    artwork={<button type="button" className="home-quick-pick__play" onClick={play} disabled={!play || !playable} aria-label={`Play ${title}`}>
      {artworkUrl ? <img src={artworkUrl} alt="" /> : <span aria-hidden="true">AO</span>}<span className="home-quick-pick__play-icon"><Play size={18} fill="currentColor" /></span>
    </button>}
    title={<HomeThemeIdentity animeTitle={animeTitle} presentation={presentation} />}
    subtitle={presentation.secondary}
    actions={theme && <TrackActionMenu
      item={{ itemType: 'THEME', itemId: theme.id, title: theme.title }}
      menuOnly
      liked={preference?.liked}
      disliked={preference?.disliked}
      preferredMode={preference && 'preferredMode' in preference ? preference.preferredMode : undefined}
      hasFullSize={Boolean(theme.mediaModes.fullSize)}
      onPlayNext={onPlayNext ? () => onPlayNext(theme, artworkUrl) : undefined}
      onAddToQueue={onAddToQueue ? () => onAddToQueue(theme, artworkUrl) : undefined}
      onGoToArtist={safeDestination.artistSlug ? () => navigate(`/artist/${encodeURIComponent(safeDestination.artistSlug!)}`) : undefined}
      artistName={safeDestination.artistName}
      onGoToAnime={safeDestination.animeId ? () => navigate(`/anime/${encodeURIComponent(safeDestination.animeId!)}`) : undefined}
      animeName={safeDestination.animeName}
    />}
  />
}

function themeDestinations(theme: LibraryThemeDto, library: NormalizedLibrary | null | undefined) {
  const artistName = theme.artists.find((artist) => artist.name.trim())?.name.trim() || null
  const artistSlug = artistRouteSlug(artistName)
  const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find((entry) => entry && !entry.deleted)
  return { artistName, artistSlug, animeId: anime?.kitsuId ?? null, animeName: anime?.titleEn || anime?.title || null }
}

function topPicksPath(limit: number, filter: HomeFilter, includeExtras: boolean, snapshot?: string): string {
  const params = new URLSearchParams({ limit: String(limit), includeExtras: String(includeExtras), filter })
  if (snapshot) params.set('snapshot', snapshot)
  return `/v1/home/top-picks?${params.toString()}`
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
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
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
    <ViewportMenu open={open} triggerRef={triggerRef} menuRef={menuRef} className="home-anime-actions__menu track-actions__menu" label={`${title} actions`}>
      <button type="button" role="menuitem" onClick={() => navigate(animePath)}>Open anime</button>
      <button type="button" role="menuitem" disabled={!onPlayAll || themes.length === 0} onClick={() => { setOpen(false); onPlayAll?.(themes, artworkUrl) }}>Play all themes</button>
      {playlistId && <button type="button" role="menuitem" onClick={() => navigate(`/playlist/${playlistId}`)}>Open Currently Watching playlist</button>}
      <button type="button" role="menuitem" className="track-actions__danger" onClick={remove}>{confirmingRemoval ? 'Confirm remove from library' : 'Remove from library'}</button>
    </ViewportMenu>
  </article>
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
