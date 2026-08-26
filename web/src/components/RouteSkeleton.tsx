import { ArrowRight, ListMusic, Music2, Search, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

export function RouteSkeleton({
  eyebrow = 'Web player foundation',
  title,
  description,
  icon: Icon = Music2,
  children,
}: {
  eyebrow?: string
  title: string
  description: string
  icon?: typeof Music2
  children?: ReactNode
}) {
  return (
    <section className="page" aria-labelledby="page-title">
      <header className="page-header">
        <div className="page-header__copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="page-title">{title}</h1>
          <p>{description}</p>
        </div>
        <div className="page-header__icon" aria-hidden="true"><Icon size={26} /></div>
      </header>
      {children ?? <SkeletonContent />}
    </section>
  )
}

function SkeletonContent() {
  return (
    <div className="skeleton-content" aria-label="Loading content preview">
      <div className="skeleton-toolbar">
        <div className="skeleton-line skeleton-line--wide" />
        <div className="skeleton-actions"><span /><span /></div>
      </div>
      <div className="skeleton-grid">
        {[1, 2, 3, 4, 5, 6].map((item) => <div className="skeleton-card" key={item}><span className="skeleton-card__image" /><span className="skeleton-line" /><span className="skeleton-line skeleton-line--short" /></div>)}
      </div>
      <div className="foundation-note">
        <Sparkles size={18} aria-hidden="true" />
        <span>This route is ready for server-backed content in the next milestone.</span>
        <ArrowRight size={17} aria-hidden="true" />
      </div>
    </div>
  )
}

export function HomePreview() {
  return (
    <div className="home-preview">
      <div className="welcome-panel">
        <div><span className="eyebrow">Your listening space</span><h2>Pick up where you left off.</h2><p>Connect your library to see anime themes, playlists, and recent additions here.</p></div>
        <button className="button button--primary" type="button"><Music2 size={17} /> Explore themes</button>
      </div>
      <div className="preview-section">
        <div className="section-heading"><h2>Quick picks</h2><span>Coming soon</span></div>
        <div className="quick-picks">{['Akebi’s Sailor Uniform · ED1', 'Half-Sister and Half-Sister', 'Kowloon Generic Romance · OP'].map((title) => <div className="quick-pick" key={title}><span className="artwork artwork--md" aria-hidden="true">AO</span><span><strong>{title}</strong><small>Anime theme · Ready for your library</small></span><button type="button" aria-label={`Play ${title}`}><Music2 size={17} /></button></div>)}</div>
      </div>
      <div className="preview-section"><div className="section-heading"><h2>Your playlists</h2><span>Coming soon</span></div><div className="playlist-placeholder"><ListMusic size={22} /><span>Playlist cards will appear after your first sync.</span></div></div>
    </div>
  )
}

export function SearchPreview({ query }: { query: string }) {
  return <div className="search-preview"><div className="search-preview__callout"><Search size={24} /><div><h2>{query ? `Search for “${query}”` : 'Search your anime soundtrack'}</h2><p>Search results will use the server catalog once connected.</p></div></div><div className="skeleton-grid skeleton-grid--compact">{['Anime', 'Themes', 'Artists'].map((item) => <div className="skeleton-card" key={item}><span className="skeleton-card__image" /><span className="skeleton-line skeleton-line--short" /><strong>{item}</strong></div>)}</div></div>
}
