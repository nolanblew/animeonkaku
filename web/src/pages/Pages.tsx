import { useSearchParams, useParams } from 'react-router-dom'
import { ListMusic, MonitorPlay, Settings2, Sparkles } from 'lucide-react'
import { RouteSkeleton, SearchPreview } from '../components/RouteSkeleton'
import { AnimeDetailPage, HomeCatalogPage, LibraryCatalogPage } from '../features/catalog'

export function HomePage() {
  return <HomeCatalogPage />
}

export function LibraryPage() {
  return <LibraryCatalogPage />
}

export function SearchPage() {
  const [params] = useSearchParams()
  return <RouteSkeleton eyebrow="Find your next theme" title="Search" description="Search anime, songs, artists, and playlists from one place." icon={Sparkles}><SearchPreview query={params.get('q') ?? ''} /></RouteSkeleton>
}

export function AnimePage() {
  return <AnimeDetailPage />
}

export function PlaylistPage() {
  const { playlistId } = useParams()
  return <RouteSkeleton eyebrow="Playlist" title={playlistId ? playlistId.replaceAll('-', ' ') : 'Playlist'} description="Playlist tracks and playback actions will be wired to the server catalog here." icon={ListMusic} />
}

export function NowPlayingPage() {
  return (
    <section className="now-playing-page" aria-labelledby="now-playing-title">
      <div className="now-playing-stage"><div className="now-playing-stage__art artwork artwork--hero" aria-hidden="true">AO</div><p className="eyebrow">Now playing · OP</p><h1 id="now-playing-title">POP LIFE</h1><p>FANTASTICS</p><div className="waveform" aria-hidden="true">{Array.from({ length: 54 }, (_, index) => <span key={index} style={{ height: `${20 + ((index * 17) % 58)}%` }} />)}</div><div className="now-playing-controls"><button type="button" className="icon-button icon-button--quiet" aria-label="Shuffle">↝</button><button type="button" className="icon-button icon-button--quiet" aria-label="Previous track">◀</button><button type="button" className="play-button" aria-label="Pause current track">Ⅱ</button><button type="button" className="icon-button icon-button--quiet" aria-label="Next track">▶</button><button type="button" className="icon-button icon-button--quiet" aria-label="Repeat">↻</button></div></div>
      <aside className="queue-panel" aria-label="Up next"><div className="queue-panel__heading"><span className="eyebrow">Queue</span><h2>Up next</h2></div><div className="queue-tabs" role="tablist" aria-label="Now playing panels"><button type="button" role="tab" aria-selected="true">Queue</button><button type="button" role="tab" aria-selected="false">Lyrics</button><button type="button" role="tab" aria-selected="false">Related</button></div><div className="queue-list">{['Akebi’s Sailor Uniform · ED1', 'Half-Sister and Half-Sister', 'Kowloon Generic Romance · OP', 'A Useless Brat (No-Good Kid)'].map((title) => <div className="queue-item" key={title}><span className="artwork artwork--xs" aria-hidden="true">AO</span><span><strong>{title}</strong><small>Anime theme</small></span><span className="queue-item__time">3:42</span></div>)}</div></aside>
    </section>
  )
}

export function SettingsPage() {
  return <RouteSkeleton eyebrow="Personalize" title="Settings" description="Account, playback, and server preferences will be available here." icon={Settings2} />
}

export function ServerErrorPage() {
  return <RouteSkeleton eyebrow="Service unavailable" title="We’re tuning the signal" description="This route is reserved for a server error surface with a safe retry action." icon={MonitorPlay} />
}
