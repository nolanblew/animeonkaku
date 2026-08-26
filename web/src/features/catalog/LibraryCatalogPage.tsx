import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, Search, SlidersHorizontal } from 'lucide-react'
import { selectActiveAnime } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { CatalogError, CatalogLoading } from './CatalogError'
import { AnimeGrid } from './AnimeGrid'
import { filterAndSortAnime, type LibrarySort } from './selectors'

export function LibraryCatalogPage() {
  const query = useLibraryQuery()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<LibrarySort>('recent')
  const anime = useMemo(() => query.library ? selectActiveAnime(query.library) : [], [query.library])
  const statuses = useMemo(() => [...new Set(anime.map((item) => item.watchingStatus).filter((value): value is string => Boolean(value)))].sort(), [anime])
  const filtered = useMemo(() => filterAndSortAnime(anime, search, status, sort), [anime, search, sort, status])
  const filterKey = `${search}\u0000${status}\u0000${sort}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  useEffect(() => { if (lastFilterKey !== filterKey) setLastFilterKey(filterKey) }, [filterKey, lastFilterKey])

  if (query.isPending) return <CatalogLoading label="Loading your library" />
  if (query.isError || !query.library) return <CatalogError title="Library unavailable" error={query.error} onRetry={() => void query.refetch()} />

  return (
    <section className="page catalog-page" aria-labelledby="library-title">
      <header className="catalog-page__header"><div><p className="eyebrow">Your collection</p><h1 id="library-title">Library</h1><p>{anime.length.toLocaleString()} anime synced from Kitsu. Filter the collection and keep the page light, even as it grows.</p></div><div className="catalog-page__stat"><strong>{filtered.length.toLocaleString()}</strong><span>shown</span></div></header>
      <div className="catalog-toolbar" role="toolbar" aria-label="Library filters"><label className="catalog-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Filter library</span><input type="search" aria-label="Filter library" placeholder="Filter anime, genres, or alternate titles" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="catalog-select"><SlidersHorizontal size={17} aria-hidden="true" /><span className="sr-only">Status</span><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((value) => <option value={value} key={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label className="catalog-select"><ArrowDownUp size={17} aria-hidden="true" /><span className="sr-only">Sort</span><select aria-label="Sort library" value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}><option value="recent">Recently updated</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label></div>
      {filtered.length === 0 ? <section className="catalog-empty catalog-empty--large"><h2>No anime found</h2><p>Try a different search or clear the filters to see your synced collection.</p>{(search || status !== 'all') && <button className="button button--text" type="button" onClick={() => { setSearch(''); setStatus('all') }}>Clear filters</button>}</section> : <div key={lastFilterKey}><AnimeGrid anime={filtered} library={query.library} /></div>}
    </section>
  )
}
