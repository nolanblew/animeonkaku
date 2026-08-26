import {
  Bell,
  House,
  LibraryBig,
  ListMusic,
  Menu,
  Search,
  UserRound,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from './BrandMark'
import { useAuth } from '../auth/AuthProvider'
import { MiniPlayerView } from '../player'

const primaryNavigation = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/library', label: 'Library', icon: LibraryBig },
  { to: '/playlists', label: 'Playlists', icon: ListMusic },
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
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const displayName = auth.user?.displayName || auth.user?.username || 'Anime Fan'
  const avatarUrl = auth.user?.avatarUrl

  const closeNavigation = () => setNavigationOpen(false)
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = query.trim()
    navigate(value ? `/search?q=${encodeURIComponent(value)}` : '/search')
    closeNavigation()
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
        </nav>

        <div className="sidebar__footer">
          <button className="profile-button" type="button" onClick={() => setProfileOpen((open) => !open)} aria-expanded={profileOpen}>
            <span className="avatar" aria-hidden="true">{avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={18} />}</span>
            <span className="profile-button__copy"><strong>{displayName}</strong><small>{auth.firstSync.status === 'syncing' ? 'Syncing library…' : 'Connected'}</small></span>
            <span className="profile-button__chevron" aria-hidden="true">⌄</span>
          </button>
          {profileOpen && (
            <div className="profile-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); navigate('/settings') }}>Account settings</button>
              <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); void auth.logout().then(() => navigate('/login', { replace: true })).catch(() => navigate('/login', { replace: true })) }}>Sign out</button>
            </div>
          )}
        </div>
      </aside>

      <div className="content-frame">
        <header className="topbar">
          <button className="mobile-menu-button icon-button" type="button" aria-label="Open navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}>
            <Menu size={22} />
          </button>
          <form className="global-search" role="search" aria-label="Global search" onSubmit={submitSearch}>
            <Search size={19} aria-hidden="true" />
            <input
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
            <button className="topbar__avatar" type="button" aria-label="Open profile menu" onClick={() => setProfileOpen((open) => !open)}>
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={19} />}
            </button>
          </div>
        </header>

        <main className="main-content" id="main-content" tabIndex={-1}>
          {auth.firstSync.status === 'syncing' && <p className="sync-status" role="status">Syncing your library…</p>}
          {children ?? <Outlet />}
        </main>
      </div>
      {location.pathname !== '/now-playing' && <MiniPlayerView onOpen={() => navigate('/now-playing')} />}
    </div>
  )
}
