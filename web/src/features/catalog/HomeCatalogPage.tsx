import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ListMusic } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { useLibraryQuery } from '../../lib/query'
import { AnimeCard } from './AnimeCard'
import { CatalogError, CatalogLoading } from './CatalogError'
import type { BrowserHomeResponse } from './types'

export function HomeCatalogPage() {
  const home = useQuery<BrowserHomeResponse>({
    queryKey: ['home'],
    queryFn: ({ signal }) => apiClient.get<BrowserHomeResponse>('/v1/home?limit=24', { signal }),
    staleTime: 30_000,
    retry: 1,
  })
  const libraryQuery = useLibraryQuery()

  if (home.isPending) return <CatalogLoading label="Loading your home" />
  if (home.isError || !home.data) return <CatalogError title="Home unavailable" error={home.error} onRetry={() => void home.refetch()} />
  const data = home.data
  const library = libraryQuery.library
  return (
    <section className="page catalog-page" aria-labelledby="home-title">
      <header className="catalog-page__header">
        <div><p className="eyebrow">Your listening space</p><h1 id="home-title">Welcome back</h1><p>Pick up where you left off and discover another anime theme to keep close.</p></div>
        <Link className="button button--primary" to="/library">Browse library <ArrowRight size={17} /></Link>
      </header>
      <CatalogHomeSection title="Continue watching" subtitle="Jump back into your current shows" anime={data.continueWatching} library={library} />
      <CatalogHomeSection title="Recently added" subtitle="Freshly synced from Kitsu" anime={data.recentlyAdded} library={library} />
      <section className="catalog-section" aria-labelledby="home-playlists-title">
        <div className="catalog-section__heading"><div><p className="eyebrow">Your collections</p><h2 id="home-playlists-title">Playlists</h2></div><Link to="/library" className="catalog-section__link">Open library <ArrowRight size={15} /></Link></div>
        {data.playlists.length === 0 ? <p className="catalog-empty">Create a playlist to keep your favorite themes together.</p> : <div className="catalog-playlist-grid">{data.playlists.map((playlist) => <Link className="catalog-playlist-card" to={`/playlist/${playlist.id}`} key={playlist.id}><span className="catalog-playlist-card__icon"><ListMusic size={23} /></span><span><strong>{playlist.name}</strong><small>{playlist.itemCount} {playlist.itemCount === 1 ? 'track' : 'tracks'}{playlist.isAuto ? ' · Auto' : ''}</small></span><ArrowRight size={18} aria-hidden="true" /></Link>)}</div>}
      </section>
    </section>
  )
}

function CatalogHomeSection({ title, subtitle, anime, library }: { title: string; subtitle: string; anime: BrowserHomeResponse['continueWatching']; library: ReturnType<typeof useLibraryQuery>['library'] }) {
  const items = anime.map((summary) => {
    const full = library?.animeById[summary.kitsuId]
    return full ?? { kitsuId: summary.kitsuId, title: summary.title, titleEn: summary.title, titleRomaji: null, titleJa: null, posterUrl: summary.posterUrl, watchingStatus: null, subtype: null, episodeCount: null, genres: [] }
  })
  return <section className="catalog-section" aria-labelledby={`${title.replaceAll(' ', '-').toLocaleLowerCase()}-title`}><div className="catalog-section__heading"><div><p className="eyebrow">Keep listening</p><h2 id={`${title.replaceAll(' ', '-').toLocaleLowerCase()}-title`}>{title}</h2><p>{subtitle}</p></div><span className="catalog-section__count">{items.length} {items.length === 1 ? 'show' : 'shows'}</span></div>{items.length === 0 ? <p className="catalog-empty">Nothing here yet. Your next sync will fill this space.</p> : <div className="catalog-home-grid">{items.map((item) => <AnimeCard key={item.kitsuId} anime={item} themeCount={library ? Object.values(library.themesById).filter((theme) => !theme.deleted && theme.kitsuAnimeIds.includes(item.kitsuId)).length : undefined} />)}</div>}</section>
}
