import { lazy, Suspense, useMemo } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppErrorBoundary } from './ErrorBoundary'
import { ResponsiveShell } from '../components/ResponsiveShell'
import { ErrorState } from '../components/ErrorState'
import { LoginPage } from '../pages/LoginPage'
import { AuthProvider, useAuth } from '../auth/AuthProvider'
import { AppQueryProvider, useLibraryQuery } from '../lib/query'
import { PlayerProvider } from '../player'
import type { QueuePreferenceSnapshot } from '../player/preferenceQueue'

const HomePage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.HomePage })))
const LibraryPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.LibraryPage })))
const SearchPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.SearchPage })))
const AnimePage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.AnimePage })))
const ArtistPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.ArtistPage })))
const RelatedMusicPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.RelatedMusicPage })))
const ReleasePage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.ReleasePage })))
const PlaylistPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.PlaylistPage })))
const PlaylistsPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.PlaylistsPage })))
const NowPlayingPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.NowPlayingPage })))
const SettingsPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.SettingsPage })))
const SyncPage = lazy(async () => import('../features/sync/SyncPage').then((module) => ({ default: module.SyncPage })))

function RouteLoading() {
  return <div className="route-loading" role="status" aria-live="polite"><span className="spinner" /> Loading Anime Ongaku…</div>
}

export function App() {
  return (
    <AppQueryProvider>
      <AuthProvider>
        <AppErrorBoundary>
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<AuthenticatedShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="library" element={<LibraryPage />} />
                  <Route path="search" element={<SearchPage />} />
                  <Route path="anime/:animeId" element={<AnimePage />} />
                  <Route path="anime/:animeId/related-music" element={<RelatedMusicPage />} />
                  <Route path="artist/:artistSlug" element={<ArtistPage />} />
                  <Route path="release/:releaseId" element={<ReleasePage />} />
                  <Route path="playlist/:playlistId" element={<PlaylistPage />} />
                  <Route path="playlists" element={<PlaylistsPage />} />
                  <Route path="now-playing" element={<NowPlayingPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="sync" element={<SyncPage />} />
                  <Route path="error" element={<ErrorState details="The server returned an unexpected response." />} />
                  <Route path="*" element={<ErrorState kind="not-found" details="No route matched the requested path." />} />
                </Route>
              </Route>
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </AuthProvider>
    </AppQueryProvider>
  )
}

function RequireAuth() {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'loading') return <RouteLoading />
  if (auth.status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />
  }
  if (auth.firstSync.status === 'syncing' && location.pathname !== '/sync') {
    return <Navigate to="/sync" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />
  }
  return <Outlet />
}

function AuthenticatedShell() {
  const auth = useAuth()
  const library = useLibraryQuery({ live: true }).library
  const preferenceSnapshot = useMemo<QueuePreferenceSnapshot>(() => ({
    themesById: library?.prefsByThemeId ?? {},
    songsById: library?.songPrefsById ?? {},
  }), [library?.prefsByThemeId, library?.songPrefsById])
  return <PlayerProvider persistenceUserId={auth.user?.kitsuUserId} preferenceSnapshot={preferenceSnapshot}><ResponsiveShell /></PlayerProvider>
}
