import { Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { createEmptyLibrary, type NormalizedLibrary } from '../../lib/library'
import { artistRouteSlug } from '../../lib/navigation'
import { useLibraryQuery } from '../../lib/query'
import { TrackActionMenu } from '../libraryactions'
import {
  findLibraryMatches,
  MAX_LIBRARY_RESULTS,
  parseMusicSearchResponse,
  sanitizeSearchQuery,
  SEARCH_DEBOUNCE_MS,
  type MusicSearchResponse,
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
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const routeQuery = params.get('q') ?? ''
  const query = sanitizeSearchQuery(routeQuery)
  const library = suppliedLibrary ?? createEmptyLibrary()
  const localMatches = useMemo(() => findLibraryMatches(library, query), [library, query])
  const [inputValue, setInputValue] = useState(routeQuery)
  const [serverResults, setServerResults] = useState<MusicSearchResponse>({ releases: [], tracks: [] })
  const [requestState, setRequestState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  useEffect(() => setInputValue(routeQuery), [routeQuery])

  useEffect(() => {
    let cancelled = false
    setServerResults({ releases: [], tracks: [] })
    setRequestState('idle')
    if (!query) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setRequestState('loading')
      void apiClient.get<unknown>(`/v1/search?${new URLSearchParams({ q: query }).toString()}`)
        .then((response) => {
          if (cancelled) return
          setServerResults(parseMusicSearchResponse(response))
          setRequestState('success')
        })
        .catch(() => {
          if (cancelled) return
          setServerResults({ releases: [], tracks: [] })
          setRequestState('error')
        })
    }, debounceMs)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [debounceMs, query])

  const hasResults = localMatches.anime.length > 0 || localMatches.themes.length > 0 || localMatches.playlists.length > 0 || serverResults.tracks.length > 0 || serverResults.releases.length > 0

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
          <p>Search the music catalog and the anime, themes, and playlists already in your library.</p>
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
      {query && requestState === 'error' && <p className="account-search-error" role="alert">We could not complete search right now. Try again.</p>}

      {query && localMatches.anime.length + localMatches.themes.length + localMatches.playlists.length > 0 && (
        <section className="account-search-results" aria-labelledby="library-match-title">
          <div className="account-search-results__heading"><h2 id="library-match-title">Your library matches</h2><span>Up to {MAX_LIBRARY_RESULTS.anime + MAX_LIBRARY_RESULTS.themes + MAX_LIBRARY_RESULTS.playlists} shown</span></div>
          <div className="account-search-results__groups">
            <LocalGroup title="Anime" items={localMatches.anime.map((item) => ({ id: item.kitsuId, title: item.title ?? item.titleEn ?? item.kitsuId, detail: item.watchingStatus ?? 'In your library', href: `/anime/${encodeURIComponent(item.kitsuId)}` }))} />
            <LocalGroup title="Themes" items={localMatches.themes.map((item) => ({ id: String(item.id), title: item.title, detail: item.themeType ?? 'Theme', action: onPlayTheme ? { label: `Play ${item.title}`, onClick: () => onPlayTheme(item) } : undefined }))} />
            <LocalGroup title="Playlists" items={localMatches.playlists.map((item) => ({ id: String(item.id), title: item.name, detail: `${item.items.length || item.entries.length} tracks`, href: `/playlist/${encodeURIComponent(String(item.id))}` }))} />
          </div>
        </section>
      )}

      {query && requestState !== 'loading' && requestState !== 'error' && (serverResults.tracks.length > 0 || serverResults.releases.length > 0) && (
        <section className="account-search-results" aria-labelledby="music-match-title">
          <div className="account-search-results__heading"><h2 id="music-match-title">Music catalog</h2><span>Server results</span></div>
          <div className="account-search-results__groups">
            {serverResults.tracks.length > 0 && <div className="account-search-results__group"><h3>Tracks</h3><ul>{serverResults.tracks.map((result, index) => <SearchTrackRow key={`track-${result.track?.id ?? index}`} result={result} onPlay={onPlayTrack} onPlayNext={onPlayNextTrack} onAddToQueue={onAddToQueueTrack} onReplaceQueue={onReplaceQueueTrack} onNavigate={navigate} />)}</ul></div>}
            {serverResults.releases.length > 0 && <div className="account-search-results__group"><h3>Releases</h3><ul>{serverResults.releases.map((result, index) => <li key={`release-${result.release?.id ?? index}`}><span className="account-search-result-copy">{validId(result.release?.id) ? <Link to={`/release/${result.release!.id}`}>{result.release?.title ?? 'Untitled release'}</Link> : <strong>{result.release?.title ?? 'Untitled release'}</strong>}<span>{result.anime?.map((anime) => anime.title ?? anime.titleEn).filter(Boolean).join(', ') || result.release?.artistCredit || 'Music release'}</span></span></li>)}</ul></div>}
          </div>
        </section>
      )}

      {query && requestState === 'success' && !hasResults && <section className="account-search-empty" aria-live="polite"><h2>No matches found</h2><p>Try a different title, artist, or playlist name.</p></section>}
    </section>
  )
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

function LocalGroup({ title, items }: { title: string; items: Array<{ id: string; title: string; detail: string; href?: string; action?: { label: string; onClick: () => void } }> }) {
  if (items.length === 0) return null
  return <div className="account-search-results__group"><h3>{title}</h3><ul>{items.map((item) => <li key={item.id}><span className="account-search-result-copy">{item.href ? <Link to={item.href}>{item.title}</Link> : <strong>{item.title}</strong>}<span>{item.detail}</span></span>{item.action && <button type="button" aria-label={item.action.label} onClick={item.action.onClick}>Play</button>}</li>)}</ul></div>
}

export { findLibraryMatches, MAX_LIBRARY_RESULTS } from './search'
