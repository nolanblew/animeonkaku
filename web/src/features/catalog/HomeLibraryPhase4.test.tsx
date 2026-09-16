import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '../../lib/api'
import type { NormalizedLibrary } from '../../lib/library'
import { useAuth } from '../../auth/AuthProvider'
import { useLibraryQuery } from '../../lib/query'
import { HomeCatalogPage, LibraryCatalogPage } from './index'

vi.mock('../../lib/query', async () => ({
  ...await vi.importActual<typeof import('../../lib/query')>('../../lib/query'),
  useLibraryQuery: vi.fn(),
}))

vi.mock('../../auth/AuthProvider', async () => ({
  ...await vi.importActual<typeof import('../../auth/AuthProvider')>('../../auth/AuthProvider'),
  useAuth: vi.fn(),
}))

const library: NormalizedLibrary = {
  cursor: 10,
  animeById: {
    a: {
      kitsuId: 'a',
      animeThemesId: 11,
      title: 'Frieren: Beyond Journey’s End',
      titleEn: 'Frieren: Beyond Journey’s End',
      titleRomaji: null,
      titleJa: null,
      posterUrl: 'https://images.example/a.jpg',
      coverUrl: null,
      watchingStatus: 'current',
      subtype: 'TV',
      startDate: null,
      endDate: null,
      episodeCount: 12,
      ageRating: null,
      averageRating: null,
      userRating: null,
      libraryUpdatedAt: 10,
      slug: 'frieren',
      genres: ['Drama'],
      updatedAt: 10,
      deleted: false,
    },
    b: {
      kitsuId: 'b',
      animeThemesId: 12,
      title: 'Bocchi the Rock!',
      titleEn: 'Bocchi the Rock!',
      titleRomaji: null,
      titleJa: null,
      posterUrl: 'https://images.example/b.jpg',
      coverUrl: null,
      watchingStatus: 'completed',
      subtype: 'TV',
      startDate: null,
      endDate: null,
      episodeCount: 12,
      ageRating: null,
      averageRating: null,
      userRating: null,
      libraryUpdatedAt: 9,
      slug: 'bocchi',
      genres: ['Music'],
      updatedAt: 9,
      deleted: false,
    },
  },
  themesById: {
    '1': {
      id: 1,
      animeThemesAnimeId: 11,
      kitsuAnimeIds: ['a'],
      title: 'Opening',
      themeType: 'OP',
      artists: [],
      audioUrl: '/audio/1',
      videoUrl: null,
      audioState: 'READY',
      durationSeconds: 90,
      fileSize: null,
      mediaModes: { tvSize: { url: '/audio/1', durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
      updatedAt: 10,
      deleted: false,
    },
    '2': {
      id: 2,
      animeThemesAnimeId: 12,
      kitsuAnimeIds: ['b'],
      title: 'Top ending',
      themeType: 'ED',
      artists: [{ name: 'Kessoku Band', asCharacter: null, alias: null }],
      audioUrl: '/audio/2',
      videoUrl: null,
      audioState: 'READY',
      durationSeconds: 100,
      fileSize: null,
      mediaModes: { tvSize: { url: '/audio/2', durationSeconds: 100, fileSize: null }, fullSize: null, video: null },
      updatedAt: 9,
      deleted: false,
    },
  },
  prefsByThemeId: {},
  songPrefsById: {},
  playlistsById: {},
  musicCatalogByAnimeId: {},
}

function renderWithQuery(ui: React.ReactElement, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>), client }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function homeResponse() {
  return {
    serverTime: 10,
    continueWatching: [{ kitsuId: 'a', title: 'Frieren: Beyond Journey’s End', posterUrl: '/a.jpg', updatedAt: 10 }],
    recentlyAdded: [{ kitsuId: 'b', title: 'Bocchi the Rock!', posterUrl: '/b.jpg', updatedAt: 9 }],
    topSongs: [{ id: 2, title: 'Top ending', animeTitle: 'Bocchi the Rock!', artistName: 'Kessoku Band', artworkUrl: '/b.jpg' }],
    snapshot: 'snapshot-1',
    generatedAt: 10,
    expiresAt: 1_800_010,
    total: 1,
    items: [{ key: 'THEME:1', itemType: 'THEME', itemId: 1, reason: 'FAVORITE', artworkUrl: '/a.jpg', anime: { kitsuId: 'a', title: 'Frieren: Beyond Journey’s End', titleEn: 'Frieren: Beyond Journey’s End', titleRomaji: null, titleJa: null, posterUrl: '/a.jpg' }, theme: library.themesById['1'], preference: null }],
    playlists: [],
    nextCursor: null,
  }
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ status: 'authenticated', user: { kitsuUserId: 'test-user', username: 'tester', displayName: null, avatarUrl: null }, me: null, firstSync: { status: 'ready', mode: null, syncMode: null, isNewUser: false }, reauthentication: { status: 'idle', returnTo: null }, login: vi.fn(), logout: vi.fn(), requireReauthentication: vi.fn(), updateProfile: vi.fn(), uploadAvatar: vi.fn(), removeAvatar: vi.fn(), markInitialSyncReady: vi.fn(), refresh: vi.fn() } as never)
  vi.mocked(useLibraryQuery).mockReturnValue({
    status: 'success',
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    library,
  } as never)
  vi.spyOn(apiClient, 'get').mockReset()
})

describe('Phase 4 Home and Library navigation contracts', () => {
  it('initializes the Library tab from the URL query', () => {
    renderWithQuery(<Routes><Route path="/library" element={<><LibraryCatalogPage /><LocationProbe /></>} /></Routes>, ['/library?tab=songs'])

    expect(screen.getByRole('tab', { name: 'Songs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: 'Filter songs' })).toBeInTheDocument()
  })

  it('keeps Library tab changes addressable for refresh and deep links', async () => {
    renderWithQuery(<Routes><Route path="/library" element={<><LibraryCatalogPage /><LocationProbe /></>} /></Routes>, ['/library'])

    await userEvent.click(screen.getByRole('tab', { name: 'Playlists' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/library?tab=playlists')
  })

  it('renders currently watching and top songs from the home projection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)

    renderWithQuery(<HomeCatalogPage />)

    expect(await screen.findByRole('heading', { name: 'Currently Watching' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Frieren: Beyond Journey’s End' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Top songs' })).toBeInTheDocument()
    const topSongs = screen.getByRole('region', { name: 'Top songs' })
    expect(within(topSongs).getAllByText('Bocchi the Rock!', { selector: '.home-theme-identity__anime' }).length).toBeGreaterThan(0)
    expect(within(topSongs).getAllByText('ED', { selector: '.home-theme-identity__type' }).length).toBeGreaterThan(0)
    expect(within(topSongs).getByText('Top ending · Kessoku Band')).toBeInTheDocument()
  })

  it('keeps the home theme type visible beside long anime titles', async () => {
    const longAnimeTitle = 'The Very Long Anime Title That Should Keep Its Theme Identity Visible'
    const longTitleLibrary = {
      ...library,
      animeById: {
        ...library.animeById,
        b: { ...library.animeById.b, title: longAnimeTitle, titleEn: longAnimeTitle },
      },
    }
    vi.mocked(useLibraryQuery).mockReturnValue({
      status: 'success', isPending: false, isError: false, isSuccess: true, error: null, library: longTitleLibrary,
    } as never)
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)

    renderWithQuery(<HomeCatalogPage />)

    const topSongs = await screen.findByRole('region', { name: 'Top songs' })
    const animeTitle = within(topSongs).getByText(longAnimeTitle, { selector: '.home-theme-identity__anime' })
    expect(animeTitle.previousElementSibling).toHaveClass('home-theme-identity__type')
    expect(animeTitle.previousElementSibling).toHaveTextContent('ED')
    expect(within(topSongs).getByText('Top ending · Kessoku Band')).toBeInTheDocument()
    expect(animeTitle.parentElement).not.toHaveTextContent(`${longAnimeTitle} · ED`)
  })

  it('plays the full Top picks collection without expanding the preview', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)
    const onPlayTopPicks = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayTopPicks={onPlayTopPicks} />)

    await screen.findByRole('heading', { name: 'Top picks' })
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(onPlayTopPicks).toHaveBeenCalledWith(expect.any(Array))
    expect(screen.queryByRole('dialog', { name: 'Top picks' })).not.toBeInTheDocument()
  })

  it('opens the full Top picks collection in a focus-trapped dialog', async () => {
    const seed = homeResponse()
    const previewItems = Array.from({ length: 6 }, (_, index) => ({ ...seed.items[0], key: `THEME:${index + 1}`, itemId: index + 1 }))
    const preview = { ...seed, snapshot: 'stable-preview', generatedAt: Date.now(), expiresAt: Date.now() + 1_800_000, total: 60, items: previewItems }
    const full = { ...preview, total: 7, items: [...previewItems, { ...seed.items[0], key: 'THEME:7', itemId: 7 }] }
    const paths: string[] = []
    vi.mocked(apiClient.get).mockImplementation((path) => {
      paths.push(path)
      const limit = new URL(path, 'http://anime-ongaku.test').searchParams.get('limit')
      if (limit === '24') return Promise.resolve(seed) as never
      if (limit === '6') return Promise.resolve(preview) as never
      return Promise.resolve(full) as never
    })
    const onPlayTopPicks = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayTopPicks={onPlayTopPicks} />)

    const previewRegion = await screen.findByRole('region', { name: 'Top picks' })
    expect(previewRegion.querySelectorAll('.home-quick-pick')).toHaveLength(6)
    expect(paths.some((path) => path.includes('limit=6') && path.includes('includeExtras=true') && path.includes('filter=ALL'))).toBe(true)

    await userEvent.click(within(previewRegion).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(onPlayTopPicks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ key: 'THEME:7' })])))
    expect(screen.queryByRole('dialog', { name: 'Top picks' })).not.toBeInTheDocument()
    expect(previewRegion.querySelectorAll('.home-quick-pick')).toHaveLength(6)

    const seeAll = within(previewRegion).getByRole('button', { name: /See all/ })
    await userEvent.click(seeAll)
    const dialog = await screen.findByRole('dialog', { name: 'Top picks' })
    expect(dialog.querySelectorAll('.home-quick-pick')).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Back to preview' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Top picks' })).not.toBeInTheDocument())
    expect(seeAll).toHaveFocus()
  })

  it('refreshes the preview before loading when the full snapshot expires', async () => {
    const seed = homeResponse()
    const oldPreview = { ...seed, snapshot: 'old-snapshot', generatedAt: Date.now(), expiresAt: Date.now() + 1_800_000 }
    const latestPreview = { ...oldPreview, snapshot: 'latest-snapshot', items: [{ ...seed.items[0], key: 'THEME:2', itemId: 2 }] }
    const latestFull = { ...latestPreview, total: 2, items: [...latestPreview.items, { ...seed.items[0], key: 'THEME:3', itemId: 3 }] }
    const paths: string[] = []
    let previewCalls = 0
    vi.mocked(apiClient.get).mockImplementation((path) => {
      paths.push(path)
      const url = new URL(path, 'http://anime-ongaku.test')
      const limit = url.searchParams.get('limit')
      if (limit === '24') return Promise.resolve(seed) as never
      if (limit === '6') return Promise.resolve(previewCalls++ === 0 ? oldPreview : latestPreview) as never
      if (url.searchParams.get('snapshot') === 'old-snapshot') return Promise.reject(new ApiError(410, 'TOP_PICKS_SNAPSHOT_EXPIRED')) as never
      return Promise.resolve(latestFull) as never
    })

    renderWithQuery(<HomeCatalogPage />)

    const previewRegion = await screen.findByRole('region', { name: 'Top picks' })
    await userEvent.click(within(previewRegion).getByRole('button', { name: /See all/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Top picks' })
    await waitFor(() => expect(dialog.querySelectorAll('.home-quick-pick')).toHaveLength(2))

    expect(previewRegion.querySelectorAll('.home-quick-pick')).toHaveLength(1)
    expect(paths.filter((path) => new URL(path, 'http://anime-ongaku.test').searchParams.get('limit') === '6').length).toBe(2)
    expect(paths.some((path) => path.includes('limit=60') && path.includes('snapshot=old-snapshot'))).toBe(true)
    expect(paths.some((path) => path.includes('limit=60') && path.includes('snapshot=latest-snapshot'))).toBe(true)
  })

  it('does not play a stale full response after the recommendation filter changes', async () => {
    const seed = homeResponse()
    const allPreview = { ...seed, snapshot: 'all-snapshot', generatedAt: Date.now(), expiresAt: Date.now() + 1_800_000 }
    const openingsPreview = { ...seed, snapshot: 'openings-snapshot', generatedAt: Date.now(), expiresAt: Date.now() + 1_800_000, items: [{ ...seed.items[0], key: 'THEME:99', itemId: 99, theme: { ...seed.items[0].theme, title: 'Opening filter pick' } }] }
    const staleFull = { ...allPreview, total: 2, items: [...allPreview.items, { ...seed.items[0], key: 'THEME:100', itemId: 100 }] }
    let resolveStaleFull: ((response: unknown) => void) | undefined
    let fullRequested = false
    const staleFullRequest = new Promise((resolve) => { resolveStaleFull = resolve })
    vi.mocked(apiClient.get).mockImplementation((path) => {
      const url = new URL(path, 'http://anime-ongaku.test')
      const limit = url.searchParams.get('limit')
      if (limit === '24') return Promise.resolve(seed) as never
      if (limit === '6') return Promise.resolve(url.searchParams.get('filter') === 'OP' ? openingsPreview : allPreview) as never
      fullRequested = true
      return staleFullRequest as never
    })
    const onPlayTopPicks = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayTopPicks={onPlayTopPicks} />)

    const previewRegion = await screen.findByRole('region', { name: 'Top picks' })
    await userEvent.click(within(previewRegion).getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(fullRequested).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Openings' }))
    await waitFor(() => expect(screen.getByText('Opening filter pick')).toBeInTheDocument())
    resolveStaleFull?.(staleFull)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onPlayTopPicks).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Top picks' })).not.toBeInTheDocument()
  })

  it('does not refetch an empty filter result continuously', async () => {
    const seed = homeResponse()
    let topPicksCalls = 0
    vi.mocked(apiClient.get).mockImplementation((path) => {
      const limit = new URL(path, 'http://anime-ongaku.test').searchParams.get('limit')
      if (limit === '24') return Promise.resolve(seed) as never
      topPicksCalls += 1
      return Promise.resolve({ ...seed, snapshot: `empty-${topPicksCalls}`, total: 0, items: [] }) as never
    })

    renderWithQuery(<HomeCatalogPage />)

    await screen.findByText('No tracks match this filter yet.')
    await waitFor(() => expect(topPicksCalls).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(topPicksCalls).toBe(2)
  })

  it('keeps the preview query independent from Home projection updates', async () => {
    const seed = homeResponse()
    let topPicksCalls = 0
    vi.mocked(apiClient.get).mockImplementation((path) => {
      const limit = new URL(path, 'http://anime-ongaku.test').searchParams.get('limit')
      if (limit === '24') return Promise.resolve(seed) as never
      topPicksCalls += 1
      return Promise.resolve(seed) as never
    })

    const view = renderWithQuery(<HomeCatalogPage />)
    const previewRegion = await screen.findByRole('region', { name: 'Top picks' })
    expect(previewRegion.querySelectorAll('.home-quick-pick')).toHaveLength(1)
    expect(topPicksCalls).toBe(1)

    await view.client.invalidateQueries({ queryKey: ['home'] })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Top picks' })).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(topPicksCalls).toBe(1)
    expect(screen.getByRole('region', { name: 'Top picks' }).querySelectorAll('.home-quick-pick')).toHaveLength(1)
  })

  it('opens shared menus for every Home song row', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)
    const onPlayNext = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayNext={onPlayNext} />)

    await screen.findByRole('heading', { name: 'Top picks' })
    expect(screen.getByRole('button', { name: 'More actions for Top ending' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Opening' }))

    expect(screen.getByRole('menu', { name: 'Opening actions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNext).toHaveBeenCalledTimes(1)
  })
})
