import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ListMusic, MoreHorizontal, Play, Search, SlidersHorizontal, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { browserAssetUrl } from '../../lib/assets'
import { selectActiveAnime, type LibraryThemeDto, type NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { ThemeActionSheet } from '../libraryactions'
import { AnimeGrid } from './AnimeGrid'
import { CatalogError, CatalogLoading } from './CatalogError'
import { filterAndSortAnime, type LibrarySort } from './selectors'

export interface LibraryCatalogPageProps {
  onPlayTheme?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onPlayNext?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
  onAddToQueue?: (theme: LibraryThemeDto, artworkUrl?: string | null) => void
}

type LibraryTab = 'anime' | 'songs' | 'artists' | 'playlists'
const PAGE_SIZE = 48

export function LibraryCatalogPage({ onPlayTheme, onPlayNext, onAddToQueue }: LibraryCatalogPageProps = {}) {
  const query = useLibraryQuery()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const [tab, setTab] = useState<LibraryTab>('anime')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedTheme, setSelectedTheme] = useState<LibraryThemeDto | null>(null)
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)

  const anime = useMemo(() => query.library ? selectActiveAnime(query.library) : [], [query.library])
  const statuses = useMemo(() => [...new Set(anime.map((item) => item.watchingStatus).filter((value): value is string => Boolean(value)))].sort(), [anime])
  const filteredAnime = useMemo(() => filterAndSortAnime(anime, search, status, sort), [anime, search, sort, status])
  const themes = useMemo(() => query.library ? Object.values(query.library.themesById).filter((theme) => !theme.deleted) : [], [query.library])
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredThemes = useMemo(() => themes.filter((theme) => {
    const artistNames = theme.artists.map((artist) => artist.name)
    return (!selectedArtist || artistNames.includes(selectedArtist)) && (
      !normalizedSearch || [theme.title, theme.themeType, ...artistNames].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))
    )
  }), [normalizedSearch, selectedArtist, themes])
  const artists = useMemo(() => {
    const counts = new Map<string, number>()
    for (const theme of themes) {
      for (const artist of theme.artists) {
        if (artist.name.trim()) counts.set(artist.name, (counts.get(artist.name) ?? 0) + 1)
      }
    }
    return [...counts].sort(([left], [right]) => left.localeCompare(right))
  }, [themes])
  const playlists = useMemo(() => query.library ? Object.values(query.library.playlistsById).filter((playlist) => !playlist.deleted) : [], [query.library])
  const visibleResultTotal = tab === 'songs'
    ? filteredThemes.length
    : tab === 'artists'
      ? selectedArtist
        ? filteredThemes.length
        : artists.filter(([name]) => !normalizedSearch || name.toLocaleLowerCase().includes(normalizedSearch)).length
      : tab === 'playlists'
        ? playlists.filter((playlist) => !normalizedSearch || playlist.name.toLocaleLowerCase().includes(normalizedSearch)).length
        : filteredAnime.length

  useEffect(() => setVisibleCount(PAGE_SIZE), [normalizedSearch, selectedArtist, tab])

  if (query.isPending) return <CatalogLoading label="Loading your library" />
  if (query.isError || !query.library) return <CatalogError title="Library unavailable" error={query.error} onRetry={() => void query.refetch()} />

  const total = tab === 'anime' ? anime.length : tab === 'songs' ? themes.length : tab === 'artists' ? artists.length : playlists.length
  return (
    <section className="page catalog-page" aria-labelledby="library-title">
      <header className="catalog-page__header">
        <div>
          <p className="eyebrow">Your collection</p>
          <h1 id="library-title">Library</h1>
          <p>Your synced anime, playable themes, artists, and playlists—kept responsive even when the collection grows into the thousands.</p>
        </div>
        <div className="catalog-page__stat"><strong>{total.toLocaleString()}</strong><span>{tab}</span></div>
      </header>

      <LibraryTabs tab={tab} onChange={(next) => { setTab(next); setSelectedArtist(null); setSearch('') }} />

      {tab === 'anime'
        ? <AnimeLibraryView anime={filteredAnime} library={query.library} search={search} status={status} sort={sort} statuses={statuses} onSearch={setSearch} onStatus={setStatus} onSort={setSort} />
        : <>
            <LibrarySearch tab={tab} value={search} onChange={setSearch} />
            {tab === 'songs' && <ThemeLibraryList themes={filteredThemes.slice(0, visibleCount)} library={query.library} onPlayTheme={onPlayTheme} onMore={setSelectedTheme} />}
            {tab === 'artists' && <ArtistLibraryView artists={artists} themes={filteredThemes} library={query.library} query={normalizedSearch} selectedArtist={selectedArtist} visibleCount={visibleCount} onSelectArtist={setSelectedArtist} onPlayTheme={onPlayTheme} onMore={setSelectedTheme} />}
            {tab === 'playlists' && <PlaylistLibraryView playlists={playlists} query={normalizedSearch} visibleCount={visibleCount} />}
            {visibleResultTotal > visibleCount && <button type="button" className="button button--text catalog-load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Load more</button>}
          </>}

      {selectedTheme && <ThemeActions theme={selectedTheme} library={query.library} onPlayTheme={onPlayTheme} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onClose={() => setSelectedTheme(null)} />}
    </section>
  )
}

function LibraryTabs({ tab, onChange }: { tab: LibraryTab; onChange: (tab: LibraryTab) => void }) {
  const tabs: Array<[LibraryTab, string]> = [['anime', 'Animes'], ['songs', 'Songs'], ['artists', 'Artists'], ['playlists', 'Playlists']]
  return <div className="catalog-library-tabs" role="tablist" aria-label="Library sections">{tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => onChange(value)}>{label}</button>)}</div>
}

function AnimeLibraryView({ anime, library, search, status, sort, statuses, onSearch, onStatus, onSort }: {
  anime: ReturnType<typeof selectActiveAnime>
  library: NormalizedLibrary
  search: string
  status: string
  sort: LibrarySort
  statuses: string[]
  onSearch: (value: string) => void
  onStatus: (value: string) => void
  onSort: (value: LibrarySort) => void
}) {
  return <>
    <div className="catalog-toolbar" role="toolbar" aria-label="Library filters">
      <label className="catalog-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Filter library</span><input type="search" aria-label="Filter library" placeholder="Filter anime, genres, or alternate titles" value={search} onChange={(event) => onSearch(event.target.value)} /></label>
      <label className="catalog-select"><SlidersHorizontal size={17} aria-hidden="true" /><span className="sr-only">Status</span><select aria-label="Filter by status" value={status} onChange={(event) => onStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="catalog-select"><ArrowDownUp size={17} aria-hidden="true" /><span className="sr-only">Sort</span><select aria-label="Sort library" value={sort} onChange={(event) => onSort(event.target.value as LibrarySort)}><option value="recent">Recently updated</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label>
    </div>
    {anime.length === 0 ? <section className="catalog-empty catalog-empty--large"><h2>No anime found</h2><p>Try a different search or clear the filters to see your synced collection.</p>{(search || status !== 'all') && <button className="button button--text" type="button" onClick={() => { onSearch(''); onStatus('all') }}>Clear filters</button>}</section> : <AnimeGrid key={`${search}\u0000${status}\u0000${sort}`} anime={anime} library={library} />}
  </>
}

function LibrarySearch({ tab, value, onChange }: { tab: Exclude<LibraryTab, 'anime'>; value: string; onChange: (value: string) => void }) {
  return <label className="catalog-search catalog-library-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Filter {tab}</span><input type="search" aria-label={`Filter ${tab}`} placeholder={`Filter ${tab}`} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function ThemeLibraryList({ themes, library, onPlayTheme, onMore }: { themes: LibraryThemeDto[]; library: NormalizedLibrary; onPlayTheme?: LibraryCatalogPageProps['onPlayTheme']; onMore: (theme: LibraryThemeDto) => void }) {
  if (themes.length === 0) return <p className="catalog-empty">No themes match this view.</p>
  return <div className="catalog-theme-list">{themes.map((theme) => {
    const artwork = themeArtwork(theme, library)
    return <article className="catalog-theme-row" key={theme.id}>
      {artwork ? <img className="catalog-theme-row__image" src={browserAssetUrl(artwork)} alt="" loading="lazy" /> : <span className="catalog-theme-row__art" aria-hidden="true">AO</span>}
      <div><h3>{theme.title}</h3><p>{[theme.themeType, theme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · ')}</p></div>
      <button type="button" className="catalog-theme-row__play" onClick={() => onPlayTheme?.(theme, artwork)} disabled={!onPlayTheme || theme.audioState !== 'READY'} aria-label={`Play ${theme.title}`}><Play size={16} fill="currentColor" /></button>
      <button type="button" className="catalog-theme-row__more" onClick={() => onMore(theme)} aria-label={`More actions for ${theme.title}`}><MoreHorizontal size={18} /></button>
    </article>
  })}</div>
}

function ArtistLibraryView({ artists, themes, library, query, selectedArtist, visibleCount, onSelectArtist, onPlayTheme, onMore }: {
  artists: Array<[string, number]>
  themes: LibraryThemeDto[]
  library: NormalizedLibrary
  query: string
  selectedArtist: string | null
  visibleCount: number
  onSelectArtist: (artist: string | null) => void
  onPlayTheme?: LibraryCatalogPageProps['onPlayTheme']
  onMore: (theme: LibraryThemeDto) => void
}) {
  if (selectedArtist) return <><button type="button" className="button button--text" onClick={() => onSelectArtist(null)}>← All artists</button><h2>{selectedArtist}</h2><ThemeLibraryList themes={themes.slice(0, visibleCount)} library={library} onPlayTheme={onPlayTheme} onMore={onMore} /></>
  const matches = artists.filter(([name]) => !query || name.toLocaleLowerCase().includes(query)).slice(0, visibleCount)
  if (matches.length === 0) return <p className="catalog-empty">No artists match this view.</p>
  return <div className="catalog-artist-grid">{matches.map(([name, count]) => <button type="button" key={name} onClick={() => onSelectArtist(name)}><UserRound size={21} /><span><strong>{name}</strong><small>{count} {count === 1 ? 'theme' : 'themes'}</small></span></button>)}</div>
}

function PlaylistLibraryView({ playlists, query, visibleCount }: { playlists: NormalizedLibrary['playlistsById'][string][]; query: string; visibleCount: number }) {
  const matches = playlists.filter((playlist) => !query || playlist.name.toLocaleLowerCase().includes(query)).slice(0, visibleCount)
  if (matches.length === 0) return <p className="catalog-empty">No playlists match this view.</p>
  return <div className="catalog-playlist-grid">{matches.map((playlist) => <Link className="catalog-playlist-card" to={`/playlist/${playlist.id}`} key={playlist.id}><span className="catalog-playlist-card__icon"><ListMusic size={23} /></span><span><strong>{playlist.name}</strong><small>{playlist.items.length || playlist.entries.length} tracks{playlist.isDynamic ? ' · Smart' : playlist.isAuto ? ' · Auto' : ''}</small></span></Link>)}</div>
}

function ThemeActions({ theme, library, onPlayTheme, onPlayNext, onAddToQueue, onClose }: {
  theme: LibraryThemeDto
  library: NormalizedLibrary
  onPlayTheme?: LibraryCatalogPageProps['onPlayTheme']
  onPlayNext?: LibraryCatalogPageProps['onPlayNext']
  onAddToQueue?: LibraryCatalogPageProps['onAddToQueue']
  onClose: () => void
}) {
  const preference = library.prefsByThemeId[String(theme.id)]
  const artwork = themeArtwork(theme, library)
  const animeId = theme.kitsuAnimeIds[0]
  return <ThemeActionSheet themeId={theme.id} title={theme.title} subtitle={[theme.themeType, theme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · ')} liked={preference?.liked} disliked={preference?.disliked} preferredMode={preference?.preferredMode} hasFullSize={Boolean(theme.mediaModes.fullSize)} inLibrary animeKitsuId={animeId} inAnimeLibrary={Boolean(theme.kitsuAnimeIds.some((id) => library.animeById[id] && !library.animeById[id]?.deleted))} onPlay={onPlayTheme ? () => onPlayTheme(theme, artwork) : undefined} onPlayNext={onPlayNext ? () => onPlayNext(theme, artwork) : undefined} onAddToQueue={onAddToQueue ? () => onAddToQueue(theme, artwork) : undefined} onClose={onClose} />
}

function themeArtwork(theme: LibraryThemeDto, library: NormalizedLibrary): string | null {
  const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find((entry) => entry && !entry.deleted)
  return anime?.posterUrl ?? anime?.coverUrl ?? null
}
