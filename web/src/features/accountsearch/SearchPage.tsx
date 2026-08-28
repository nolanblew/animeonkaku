import { Disc3, Globe2, ListMusic, Play, Search, Sparkles, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { createEmptyLibrary, type NormalizedLibrary } from '../../lib/library'
import { artistRouteSlug } from '../../lib/navigation'
import { useLibraryQuery } from '../../lib/query'
import { themePresentation } from '../../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../../lib/animeTitlePreference'
import { TrackActionMenu } from '../libraryactions'
import { playlistArtworkUrls } from '../playlists'
import { MediaCard, MediaListItem } from '../../components/MediaPresentation'
import {
  findLibraryMatches,
  parseSearchResponse,
  sanitizeSearchQuery,
  SEARCH_DEBOUNCE_MS,
  type AnimeThemesSearchTheme,
  type SearchResponse,
  type MusicSearchTrack,
} from './search'
import type { LibraryThemeDto } from '../../lib/library'
import './accountsearch.css'

export interface SearchPageProps {
  /** Optional injection keeps the feature easy to embed and test. */
  library?: NormalizedLibrary | null
  debounceMs?: number
  onPlayTheme?: (theme: LibraryThemeDto) => void
  onPlayTrack?: (result: MusicSearchTrack) => void
  onPlayNextTrack?: (result: MusicSearchTrack) => void
  onAddToQueueTrack?: (result: MusicSearchTrack) => void
  onReplaceQueueTrack?: (result: MusicSearchTrack) => void
}

export function SearchPage(props: SearchPageProps = {}) {
  if (props.library !== undefined) return <SearchPageContent {...props} suppliedLibrary={props.library} />
  return <SearchPageWithLibraryQuery {...props} />
}

function SearchPageWithLibraryQuery(props: SearchPageProps) {
  const libraryQuery = useLibraryQuery()
  return <SearchPageContent {...props} suppliedLibrary={props.library ?? libraryQuery.library} />
}

function SearchPageContent({ suppliedLibrary, debounceMs = SEARCH_DEBOUNCE_MS, onPlayTheme, onPlayTrack, onPlayNextTrack, onAddToQueueTrack, onReplaceQueueTrack }: SearchPageProps & { suppliedLibrary?: NormalizedLibrary | null }) {
  const titlePreference = useAnimeTitlePreference()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const routeQuery = params.get('q') ?? ''
  const query = sanitizeSearchQuery(routeQuery)
  const library = suppliedLibrary ?? createEmptyLibrary()
  const localMatches = useMemo(() => findLibraryMatches(library, query), [library, query])
  const [inputValue, setInputValue] = useState(routeQuery)
  const [serverResults, setServerResults] = useState<SearchResponse>({ animeThemes: { anime: [], themes: [], artists: [] }, music: { releases: [], tracks: [] } })
  const [serverResultQuery, setServerResultQuery] = useState<string | null>(null)
  const [requestState, setRequestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [retryNonce, setRetryNonce] = useState(0)

  useEffect(() => setInputValue(routeQuery), [routeQuery])

  useEffect(() => {
    let cancelled = false
    setRequestState('idle')
    if (!query) {
      setServerResults({ animeThemes: { anime: [], themes: [], artists: [] }, music: { releases: [], tracks: [] } })
      setServerResultQuery(null)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setRequestState('loading')
      void apiClient.get<unknown>(`/v1/search?${new URLSearchParams({ q: query }).toString()}`)
        .then((response) => {
          if (cancelled) return
          setServerResults(parseSearchResponse(response))
          setServerResultQuery(query)
          setRequestState('success')
        })
        .catch(() => {
          if (cancelled) return
          setRequestState('error')
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [debounceMs, query, retryNonce])

  const localCount = localMatches.anime.length + localMatches.themes.length + localMatches.artists.length + localMatches.playlists.length
  const onlineCount = serverResults.animeThemes.anime.length + serverResults.animeThemes.themes.length + serverResults.animeThemes.artists.length
  const musicCount = serverResults.music.tracks.length + serverResults.music.releases.length
  const hasResults = localCount + onlineCount + musicCount > 0

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextQuery = sanitizeSearchQuery(inputValue)
    navigate(nextQuery ? `/search?q=${encodeURIComponent(nextQuery)}` : '/search')
  }

  return (
    <section className="account-search-page" aria-labelledby="account-search-title">
      <header className="account-search-page__header">
        <div>
          <p className="account-search-page__eyebrow">Find your next theme</p>
          <h1 id="account-search-title">Search</h1>
          <p>Find what you already love, then discover more anime music from AnimeThemes.</p>
        </div>
        <div className="account-search-page__icon" aria-hidden="true"><Sparkles size={25} /></div>
      </header>

      <form className="account-search-form" role="search" aria-label="Search music" onSubmit={submitSearch}>
        <Search size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor="account-search-input">Search anime, songs, artists, and playlists</label>
        <input
          id="account-search-input"
          type="search"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Search anime, songs, artists, and playlists"
        />
        <button type="submit">Search</button>
      </form>

      {!query && <section className="account-search-empty" aria-live="polite"><Search size={22} aria-hidden="true" /><h2>Search your anime soundtrack</h2><p>Try an anime title, theme, artist, or playlist name.</p></section>}
      {query && requestState === 'loading' && <p className="account-search-status" role="status">Searching for “{query}”…</p>}
      {query && requestState === 'error' && <p className="account-search-error" role="alert">We could not complete search right now. Try again. <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>Retry search</button></p>}

      {query && localCount > 0 && (
        <section className="account-search-results account-search-results--library" aria-labelledby="library-match-title">
          <div className="account-search-results__heading"><div><p className="account-search-results__eyebrow">Already yours</p><h2 id="library-match-title">In your library</h2></div><span>{localCount} matches</span></div>
          <div className="account-search-results__groups">
            <LocalGroup title="Anime" items={localMatches.anime.map((item) => ({ id: item.kitsuId, title: preferredAnimeTitle(item, titlePreference) || item.kitsuId, detail: item.watchingStatus ?? 'In your library', href: `/anime/${encodeURIComponent(item.kitsuId)}`, imageUrl: item.posterUrl || item.coverUrl, testId: `search-anime-${item.kitsuId}` }))} />
            <LocalGroup title="Songs" items={localMatches.themes.map((item) => {
              const anime = item.kitsuAnimeIds.map((id) => library?.animeById[id]).find((entry) => entry && !entry.deleted)
              const presentation = themePresentation({ animeTitle: preferredAnimeTitle(anime, titlePreference), themeType: item.themeType, songTitle: item.title, artist: item.artists.map((artist) => artist.name).join(', ') })
              return { id: String(item.id), title: presentation.primary, detail: presentation.secondary, imageUrl: anime?.posterUrl || anime?.coverUrl, testId: `search-theme-${item.id}`, action: onPlayTheme ? { label: `Play ${item.title}`, onClick: () => onPlayTheme(item) } : undefined }
            })} />
            <LocalGroup title="Artists" items={localMatches.artists.map((item) => ({ id: item.name, title: item.name, detail: `${item.themeCount} ${item.themeCount === 1 ? 'song' : 'songs'} in your library`, href: `/artist/${encodeURIComponent(artistRouteSlug(item.name) ?? item.name)}`, fallback: <UserRound size={19} /> }))} />
            <LocalGroup title="Playlists" items={localMatches.playlists.map((item) => ({ id: String(item.id), title: item.name, detail: `${item.items.length || item.entries.length} tracks`, href: `/playlist/${encodeURIComponent(String(item.id))}`, imageUrls: playlistArtworkUrls(item, library), fallback: <ListMusic size={19} />, testId: `search-playlist-${item.id}` }))} />
          </div>
        </section>
      )}

      {query && onlineCount > 0 && (
        <section className="account-search-results account-search-results--discovery" aria-labelledby="animethemes-match-title">
          <div className="account-search-results__heading"><div><p className="account-search-results__eyebrow"><Globe2 size={13} aria-hidden="true" /> Search the web</p><h2 id="animethemes-match-title">Discover on AnimeThemes</h2></div><span>{onlineCount} results</span></div>
          {serverResults.animeThemes.anime.length > 0 && <div className="account-search-featured"><h3>Anime</h3><div className="account-search-card-grid">{serverResults.animeThemes.anime.map((anime) => <MediaCard
            key={anime.animeThemesId}
            className="account-search-card"
            href={anime.kitsuId ? `/anime/${encodeURIComponent(anime.kitsuId)}` : undefined}
            activateLabel={anime.kitsuId ? anime.name : undefined}
            imageUrl={anime.imageUrl}
            fallback={<Disc3 size={24} aria-hidden="true" />}
            title={anime.name}
            subtitle={`${anime.themeCount} ${anime.themeCount === 1 ? 'song' : 'songs'}`}
          />)}</div></div>}
          <div className="account-search-results__groups account-search-results__groups--discovery">
            {serverResults.animeThemes.themes.length > 0 && <div className="account-search-results__group"><h3>Songs</h3><ul>{serverResults.animeThemes.themes.map((theme) => <AnimeThemesThemeRow key={theme.id} theme={theme} onPlay={onPlayTheme} onNavigate={navigate} />)}</ul></div>}
            {serverResults.animeThemes.artists.length > 0 && <div className="account-search-results__group"><h3>Artists</h3><ul>{serverResults.animeThemes.artists.map((artist) => <li key={artist.id}><span className="account-search-result-copy"><Link to={`/artist/${encodeURIComponent(artist.slug)}`}>{artist.name}</Link><span>Artist on AnimeThemes</span></span></li>)}</ul></div>}
          </div>
        </section>
      )}

      {query && musicCount > 0 && (
        <section className="account-search-results" aria-labelledby="music-match-title">
          <div className="account-search-results__heading"><div><p className="account-search-results__eyebrow">Full-length music</p><h2 id="music-match-title">Tracks &amp; releases</h2></div><span>{requestState === 'success' && serverResultQuery === query ? 'From your server' : 'Previous results'}</span></div>
          <div className="account-search-results__groups">
            {serverResults.music.tracks.length > 0 && <div className="account-search-results__group"><h3>Tracks</h3><ul>{serverResults.music.tracks.map((result, index) => <SearchTrackRow key={`track-${result.track?.id ?? index}`} result={result} onPlay={onPlayTrack} onPlayNext={onPlayNextTrack} onAddToQueue={onAddToQueueTrack} onReplaceQueue={onReplaceQueueTrack} onNavigate={navigate} />)}</ul></div>}
            {serverResults.music.releases.length > 0 && <div className="account-search-results__group"><h3>Releases</h3><ul>{serverResults.music.releases.map((result, index) => <li key={`release-${result.release?.id ?? index}`}><span className="account-search-result-copy">{validId(result.release?.id) ? <Link to={`/release/${result.release!.id}`}>{result.release?.title ?? 'Untitled release'}</Link> : <strong>{result.release?.title ?? 'Untitled release'}</strong>}<span>{result.anime?.map((anime) => anime.title ?? anime.titleEn).filter(Boolean).join(', ') || result.release?.artistCredit || 'Music release'}</span></span></li>)}</ul></div>}
          </div>
        </section>
      )}

      {query && requestState === 'success' && !hasResults && <section className="account-search-empty" aria-live="polite"><h2>No matches found</h2><p>Try a different title, artist, or playlist name.</p></section>}
    </section>
  )
}

function AnimeThemesThemeRow({ theme, onPlay, onNavigate }: { theme: AnimeThemesSearchTheme; onPlay?: (theme: LibraryThemeDto) => void; onNavigate: (to: string) => void }) {
  const playable = onlineThemeDto(theme)
  const presentation = themePresentation({ animeTitle: theme.animeName, themeType: theme.themeType, songTitle: theme.title, artist: theme.artist })
  return <li><span className="account-search-result-copy"><strong>{presentation.primary}</strong><span><b>{theme.title}</b>{theme.artist ? ` · ${theme.artist}` : ''}</span></span><div className="account-search-result-actions">{onPlay && <button type="button" aria-label={`Play ${theme.title}`} onClick={() => onPlay(playable)}><Play size={14} aria-hidden="true" /> Play</button>}<TrackActionMenu menuOnly item={{ itemType: 'THEME', itemId: theme.id, title: theme.title }} onReplaceQueue={onPlay ? () => onPlay(playable) : undefined} onGoToArtist={theme.artist ? () => onNavigate(`/artist/${encodeURIComponent(artistRouteSlug(String(theme.artist)) ?? String(theme.artist))}`) : undefined} artistName={theme.artist ?? undefined} onGoToAnime={theme.kitsuId ? () => onNavigate(`/anime/${encodeURIComponent(String(theme.kitsuId))}`) : undefined} animeName={theme.animeName} /></div></li>
}

function onlineThemeDto(theme: AnimeThemesSearchTheme): LibraryThemeDto {
  const audioUrl = `/v1/media/audio/${theme.id}`
  return { id: theme.id, animeThemesAnimeId: theme.animeThemesAnimeId, kitsuAnimeIds: theme.kitsuId ? [theme.kitsuId] : [], title: theme.title, themeType: theme.themeType, artists: theme.artist ? theme.artist.split(',').map((name) => ({ name: name.trim(), alias: null, asCharacter: null })) : [], audioUrl, videoUrl: null, audioState: 'PENDING', durationSeconds: null, fileSize: null, mediaModes: { tvSize: { url: audioUrl, durationSeconds: null, fileSize: null }, fullSize: null, video: null }, updatedAt: 0, deleted: false }
}

function SearchTrackRow({ result, onPlay, onPlayNext, onAddToQueue, onReplaceQueue, onNavigate }: {
  result: MusicSearchTrack
  onPlay?: (result: MusicSearchTrack) => void
  onPlayNext?: (result: MusicSearchTrack) => void
  onAddToQueue?: (result: MusicSearchTrack) => void
  onReplaceQueue?: (result: MusicSearchTrack) => void
  onNavigate: (to: string) => void
}) {
  const track = result.track
  const title = track?.title?.trim() || 'Untitled track'
  const artist = track?.artistCredit?.trim() || result.releaseTitle || result.anime?.title || 'Music track'
  const artistSlug = artistRouteSlug(track?.artistCredit ?? '')
  const anime = result.anime?.kitsuId ? result.anime : undefined
  const canAct = validId(track?.id) && Boolean(track?.audioUrl && track.title?.trim())
  return <li><span className="account-search-result-copy"><strong>{title}</strong><span>{artist}</span></span><div className="account-search-result-actions">{canAct && onPlay && <button type="button" aria-label={`Play ${title}`} onClick={() => onPlay(result)}>Play</button>}{canAct && <TrackActionMenu menuOnly item={{ itemType: 'SONG', itemId: track!.id!, title }} onPlayNext={onPlayNext ? () => onPlayNext(result) : undefined} onAddToQueue={onAddToQueue ? () => onAddToQueue(result) : undefined} onReplaceQueue={onReplaceQueue ? () => onReplaceQueue(result) : undefined} onGoToArtist={artistSlug ? () => onNavigate(`/artist/${encodeURIComponent(artistSlug)}`) : undefined} artistName={artistSlug ? track?.artistCredit : undefined} onGoToAnime={anime ? () => onNavigate(`/anime/${encodeURIComponent(anime.kitsuId!)}`) : undefined} animeName={anime?.title || anime?.titleEn || undefined} onRelatedMusic={anime ? () => onNavigate(`/anime/${encodeURIComponent(anime.kitsuId!)}/related-music`) : undefined} />}</div></li>
}

function validId(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function LocalGroup({ title, items }: { title: string; items: Array<{ id: string; title: string; detail: string; href?: string; imageUrl?: string | null; imageUrls?: readonly string[]; fallback?: React.ReactNode; testId?: string; action?: { label: string; onClick: () => void } }> }) {
  if (items.length === 0) return null
  return <div className="account-search-results__group"><h3>{title}</h3><ul>{items.map((item) => <MediaListItem key={item.id} element="li" className="account-search-library-item" testId={item.testId} href={item.href} activateLabel={item.href ? item.title : undefined} title={item.title} subtitle={item.detail} imageUrl={item.imageUrl} imageUrls={item.imageUrls} fallback={item.fallback} actions={item.action && <button type="button" aria-label={item.action.label} onClick={item.action.onClick}>Play</button>} />)}</ul></div>
}

export { findLibraryMatches, MAX_LIBRARY_RESULTS } from './search'
