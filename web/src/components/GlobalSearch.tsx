import { ArrowRight, Disc3, Library, ListMusic, Search, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../lib/animeTitlePreference'
import type { NormalizedLibrary } from '../lib/library'
import { artistRouteSlug } from '../lib/navigation'
import { themePresentation } from '../lib/themePresentation'
import { findLibraryMatches, sanitizeSearchQuery } from '../features/accountsearch/search'
import { MediaListItem } from './MediaPresentation'

interface GlobalSearchProps {
  library: NormalizedLibrary | null | undefined
  inputRef: RefObject<HTMLInputElement | null>
}

const PREVIEW_LIMIT = 3

export function GlobalSearch({ library, inputRef }: GlobalSearchProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const titlePreference = useAnimeTitlePreference()
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const cleanQuery = sanitizeSearchQuery(query)
  const matches = useMemo(() => findLibraryMatches(library ?? null, cleanQuery), [cleanQuery, library])
  const resultCount = matches.anime.length + matches.themes.length + matches.artists.length + matches.playlists.length

  useEffect(() => {
    if (location.pathname !== '/search') return
    setQuery(new URLSearchParams(location.search).get('q') ?? '')
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const goToFullSearch = () => {
    setOpen(false)
    navigate(cleanQuery ? `/search?q=${encodeURIComponent(cleanQuery)}` : '/search')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    goToFullSearch()
  }

  return (
    <div className="global-search-wrap" ref={rootRef}>
      <form className="global-search" role="search" aria-label="Global search" onSubmit={submit}>
        <Search size={19} aria-hidden="true" />
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="global-search-suggestions"
          aria-expanded={open && Boolean(cleanQuery)}
          value={query}
          onFocus={() => setOpen(Boolean(cleanQuery))}
          onChange={(event) => { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
            if (event.key === 'Enter') { event.preventDefault(); goToFullSearch() }
          }}
          placeholder="Search songs, anime, artists, and playlists"
          aria-label="Search songs, anime, artists, and playlists"
        />
        <kbd>⌘ K</kbd>
      </form>

      {open && cleanQuery && (
        <div id="global-search-suggestions" className="global-search-panel" role="dialog" aria-label="Library search suggestions">
          <div className="global-search-panel__heading"><span><Library size={14} aria-hidden="true" /> From your library</span><small>{resultCount ? `${resultCount} matches` : 'No quick matches'}</small></div>
          {resultCount > 0 ? (
            <div className="global-search-panel__groups">
              <SuggestionGroup label="Anime">
                {matches.anime.slice(0, PREVIEW_LIMIT).map((anime) => (
                  <SuggestionLink key={anime.kitsuId} to={`/anime/${encodeURIComponent(anime.kitsuId)}`} imageUrl={anime.posterUrl || anime.coverUrl} title={preferredAnimeTitle(anime, titlePreference) || anime.kitsuId} detail={anime.watchingStatus ?? 'In your library'} onSelect={() => setOpen(false)} />
                ))}
              </SuggestionGroup>
              <SuggestionGroup label="Songs">
                {matches.themes.slice(0, PREVIEW_LIMIT).map((theme) => {
                  const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find((item) => item && !item.deleted)
                  const presentation = themePresentation({ animeTitle: preferredAnimeTitle(anime, titlePreference), themeType: theme.themeType, songTitle: theme.title, artist: theme.artists.map((artist) => artist.name).join(', ') })
                  return <SuggestionLink key={theme.id} to={anime ? `/anime/${encodeURIComponent(anime.kitsuId)}` : `/search?q=${encodeURIComponent(theme.title)}`} imageUrl={anime?.posterUrl || anime?.coverUrl} title={presentation.primary} detail={presentation.secondary} onSelect={() => setOpen(false)} fallback={<Disc3 size={17} />} />
                })}
              </SuggestionGroup>
              <SuggestionGroup label="Artists">
                {matches.artists.slice(0, PREVIEW_LIMIT).map((artist) => <SuggestionLink key={artist.name} to={`/artist/${encodeURIComponent(artistRouteSlug(artist.name) ?? artist.name)}`} title={artist.name} detail={`${artist.themeCount} ${artist.themeCount === 1 ? 'song' : 'songs'} in your library`} onSelect={() => setOpen(false)} fallback={<UserRound size={17} />} />)}
              </SuggestionGroup>
              <SuggestionGroup label="Playlists">
                {matches.playlists.slice(0, PREVIEW_LIMIT).map((playlist) => <SuggestionLink key={playlist.id} to={`/playlist/${playlist.id}`} title={playlist.name} detail={`${playlist.items.length || playlist.entries.length} tracks`} onSelect={() => setOpen(false)} fallback={<ListMusic size={17} />} />)}
              </SuggestionGroup>
            </div>
          ) : <p className="global-search-panel__empty">No library matches yet. Search AnimeThemes for more.</p>}
          <button className="global-search-panel__all" type="button" onClick={goToFullSearch}><span>Search all sources for “{cleanQuery}”</span><ArrowRight size={17} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}

function SuggestionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children
  if (Array.isArray(items) && items.length === 0) return null
  return <section className="global-search-panel__group"><h2>{label}</h2><div>{items}</div></section>
}

function SuggestionLink({ to, imageUrl, title, detail, fallback, onSelect }: { to: string; imageUrl?: string | null; title: string; detail: string; fallback?: React.ReactNode; onSelect: () => void }) {
  return <MediaListItem className="global-search-suggestion" href={to} onSelect={onSelect} activateLabel={title} imageUrl={imageUrl} fallback={fallback ?? title.slice(0, 1)} title={title} subtitle={detail} />
}
