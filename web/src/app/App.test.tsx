import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { apiClient } from '../lib/api'
import { queryClient } from '../lib/query'

const authenticatedMe = {
  user: { kitsuUserId: 'fan-1', username: 'fan', displayName: 'Anime Fan', avatarUrl: null },
  kitsuAuthState: 'OK',
  lastSyncAt: 100,
  devices: [],
}

beforeEach(() => {
  queryClient.clear()
  vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
    if (path === '/auth/me') return authenticatedMe
    if (path.startsWith('/v1/home')) return { serverTime: 100, continueWatching: [], recentlyAdded: [], playlists: [], nextCursor: null }
    if (path === '/v1/anime/16bit-sensation') return {
      anime: {
        kitsuId: '16bit-sensation', title: '16bit Sensation', titleEn: null, titleRomaji: null, titleJa: null,
        posterUrl: null, coverUrl: null, watchingStatus: 'CURRENT', subtype: 'TV', startDate: '2023-10-05',
        endDate: null, episodeCount: 13, ageRating: null, averageRating: null, userRating: null,
        libraryUpdatedAt: 100, slug: null, genres: [], updatedAt: 100, deleted: false, animeThemesId: 1,
      },
      themes: [],
    }
    if (path === '/v1/anime/16bit-sensation/music') return { anime: { kitsuId: '16bit-sensation', title: '16bit Sensation', titleEn: null, posterUrl: null }, releases: [] }
    return { serverTime: 100, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] }
  })
})

afterEach(() => vi.restoreAllMocks())

describe('web player app shell', () => {
  it('renders the accessible shell regions and navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument())
    expect(screen.getByRole('search', { name: /global search/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /mini player/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page')
  })

  it('renders a login page outside the player shell', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument()
  })

  it('redirects unauthenticated users to login before rendering protected routes', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }))
    render(
      <MemoryRouter initialEntries={['/library']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument()
  })

  it.each([
    ['/library', /library/i],
    ['/search?q=bleach', /search/i],
    ['/anime/16bit-sensation', /16bit sensation/i],
    ['/playlist/currently-watching', /currently watching/i],
    ['/now-playing', /pop life/i],
    ['/settings', /settings/i],
  ])('loads the lazy route at %s', async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument())
  })

  it('renders sanitized not-found details with safe expandable details', async () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument())
    const detailsButton = screen.getByRole('button', { name: /show technical details/i })
    expect(detailsButton).toBeInTheDocument()
    fireEvent.click(detailsButton)
    expect(screen.getByLabelText(/technical details/i)).toHaveTextContent('No route matched')
    expect(screen.getByLabelText(/technical details/i)).not.toHaveTextContent(/stack|postgres|token|password/i)
  })

  it('renders the 500 route with a retry action and expandable details', async () => {
    render(
      <MemoryRouter initialEntries={['/error']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show technical details/i })).toBeInTheDocument()
  })
})
