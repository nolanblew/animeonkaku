import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppErrorBoundary } from './ErrorBoundary'
import { ResponsiveShell } from '../components/ResponsiveShell'
import { ErrorState } from '../components/ErrorState'
import { LoginPage } from '../pages/LoginPage'

const HomePage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.HomePage })))
const LibraryPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.LibraryPage })))
const SearchPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.SearchPage })))
const AnimePage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.AnimePage })))
const PlaylistPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.PlaylistPage })))
const NowPlayingPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.NowPlayingPage })))
const SettingsPage = lazy(async () => import('../pages/Pages').then((module) => ({ default: module.SettingsPage })))

function RouteLoading() {
  return <div className="route-loading" role="status" aria-live="polite"><span className="spinner" /> Loading Anime Ongaku…</div>
}

export function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ResponsiveShell />}>
            <Route index element={<HomePage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="anime/:animeId" element={<AnimePage />} />
            <Route path="playlist/:playlistId" element={<PlaylistPage />} />
            <Route path="now-playing" element={<NowPlayingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="error" element={<ErrorState details="The server returned an unexpected response." />} />
            <Route path="*" element={<ErrorState kind="not-found" details="No route matched the requested path." />} />
          </Route>
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  )
}
