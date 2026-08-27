import {
  Bell,
  House,
  Library,
  Menu,
  Plus,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from './BrandMark'
import { useAuth } from '../auth/AuthProvider'
import { MiniPlayerView, runPlayerViewTransition } from '../player'
import { useLibraryQuery } from '../lib/query'

const primaryNavigation = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: Library },
]

function NavigationLink({
  to,
  label,
  icon: Icon,
  end,
  onNavigate,
}: {
  to: string
  label: string
  icon: typeof House
  end?: boolean
  onNavigate: () => void
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
      title={label}
    >
      <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  )
}

export function ResponsiveShell({ children }: { children?: ReactNode }) {
  const auth = useAuth()
  const library = useLibraryQuery({ enabled: false }).library
  const playlists = Object.values(library?.playlistsById ?? {}).filter((playlist) => !playlist.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false)
  const [topbarProfileOpen, setTopbarProfileOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const displayName = auth.user?.displayName || auth.user?.username || 'Anime Fan'
  const avatarUrl = auth.user?.avatarUrl

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      const searchInput = searchInputRef.current
      if (!searchInput) return
      searchInput.focus()
      searchInput.select()
    }

    window.addEventListener('keydown', handleSearchShortcut)
    return () => window.removeEventListener('keydown', handleSearchShortcut)
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [location.pathname, location.search])

  const closeNavigation = () => setNavigationOpen(false)
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/search')
    closeNavigation()
  }
  const openExpandedPlayer = () => {
    const playerReturnTo = `${location.pathname}${location.search}${location.hash}`
    runPlayerViewTransition(() => navigate('/now-playing', { state: { playerReturnTo } }))
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <button
        className={`navigation-scrim ${navigationOpen ? 'navigation-scrim--visible' : ''}`}
        type="button"
        aria-label="Close navigation"
        onClick={closeNavigation}
        tabIndex={navigationOpen ? 0 : -1}
      />

      <aside className={`sidebar ${navigationOpen ? 'sidebar--open' : ''}`} aria-label="Primary navigation">
        <div className="sidebar__brand"><Brand /></div>
        <button className="sidebar__close icon-button" type="button" aria-label="Close navigation" onClick={closeNavigation}>
          <X size={20} />
        </button>

        <nav className="sidebar__nav" aria-label="Primary">
          <div className="nav-group">
            {primaryNavigation.map((item) => (
              <NavigationLink key={item.to} {...item} onNavigate={closeNavigation} />
            ))}
          </div>
          <div className="sidebar-playlists">
            <div className="sidebar-playlists__heading">
              <h2><NavLink to="/playlists" onClick={closeNavigation}>Playlists</NavLink></h2>
              <NavLink to="/playlists?create=1" onClick={closeNavigation} aria-label="New playlist"><Plus size={17} aria-hidden="true" /></NavLink>
            </div>
            <div className="sidebar-playlists__list">
              {playlists.length === 0
                ? <p>No playlists yet</p>
                : playlists.map((playlist) => <NavLink key={playlist.id} to={`/playlist/${playlist.id}`} onClick={closeNavigation} title={playlist.name}>{playlist.name}</NavLink>)}
            </div>
          </div>
        </nav>

        <div className="sidebar__footer">
          <button className="profile-button" type="button" onClick={() => setSidebarProfileOpen((open) => !open)} aria-expanded={sidebarProfileOpen} aria-haspopup="menu">
            <span className="avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={18} />}</span>
            <span className="profile-button__copy"><strong>{displayName}</strong><small>{auth.firstSync.status === 'syncing' ? 'Syncing library…' : 'Connected'}</small></span>
            <span className="profile-button__chevron" aria-hidden="true">⌄</span>
          </button>
          {sidebarProfileOpen && (
            <div className="profile-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setSidebarProfileOpen(false); navigate('/settings') }}>Account settings</button>
              <button type="button" role="menuitem" onClick={() => { setSidebarProfileOpen(false); void auth.logout().then(() => navigate('/login', { replace: true })).catch(() => navigate('/login', { replace: true })) }}>Sign out</button>
            </div>
          )}
        </div>
      </aside>

      <div className={location.pathname === '/now-playing' ? 'content-frame content-frame--player' : 'content-frame'}>
        <header className="topbar">
          <button className="mobile-menu-button icon-button" type="button" aria-label="Open navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}>
            <Menu size={22} />
          </button>
          <form className="global-search" role="search" aria-label="Global search" onSubmit={submitSearch}>
            <Search size={19} aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs, anime, artists, and playlists"
              aria-label="Search songs, anime, artists, and playlists"
            />
            <kbd>⌘ K</kbd>
          </form>
          <div className="topbar__actions">
            <button className="icon-button icon-button--quiet hide-narrow" type="button" aria-label="Notifications">
              <span className="notification-dot" aria-hidden="true" />
              <Bell size={19} aria-hidden="true" />
            </button>
            <button className="topbar__avatar" type="button" aria-label="Open profile menu" aria-expanded={topbarProfileOpen} aria-haspopup="menu" onClick={() => setTopbarProfileOpen((open) => !open)}>
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={19} />}
            </button>
            {topbarProfileOpen && (
              <div className="profile-menu topbar__profile-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setTopbarProfileOpen(false); navigate('/settings') }}>Account settings</button>
                <button type="button" role="menuitem" onClick={() => { setTopbarProfileOpen(false); void auth.logout().then(() => navigate('/login', { replace: true })).catch(() => navigate('/login', { replace: true })) }}>Sign out</button>
              </div>
            )}
          </div>
        </header>

        <main className={location.pathname === '/now-playing' ? 'main-content main-content--player' : 'main-content'} id="main-content" tabIndex={-1}>
          {auth.reauthentication.status === 'required' && <div className="reauth-banner" role="alert"><span>Your session needs to reconnect. Your library and listening position are still here.</span><button type="button" className="button button--secondary" onClick={() => navigate('/login', { state: { from: auth.reauthentication.returnTo ?? `${location.pathname}${location.search}${location.hash}` } })}>Reconnect</button></div>}
          {auth.firstSync.status === 'syncing' && <p className="sync-status" role="status">Syncing your library…</p>}
          {children ?? <Outlet />}
        </main>
      </div>
      {location.pathname !== '/now-playing' && <MiniPlayerView onOpen={openExpandedPlayer} />}
    </div>
  )
}
