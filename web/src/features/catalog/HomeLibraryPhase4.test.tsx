import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { HomeCatalogPage, LibraryCatalogPage } from './index'

vi.mock('../../lib/query', () => ({
  useLibraryQuery: vi.fn(),
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
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>)
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
    playlists: [],
    nextCursor: null,
  }
}

beforeEach(() => {
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
    expect(screen.getByText('Frieren: Beyond Journey’s End')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Top songs' })).toBeInTheDocument()
    expect(screen.getByText('Top ending')).toBeInTheDocument()
  })

  it('provides Home-level Play all for the Recommended collection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)
    const onPlayAll = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayAll={onPlayAll} />)

    await screen.findByRole('heading', { name: 'Recommended' })
    await userEvent.click(screen.getByRole('button', { name: 'Play all' }))

    expect(onPlayAll).toHaveBeenCalledWith(expect.any(Array), expect.anything())
  })

  it('opens shared menus for every Home song row', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(homeResponse() as never)
    const onPlayNext = vi.fn()

    renderWithQuery(<HomeCatalogPage onPlayNext={onPlayNext} />)

    await screen.findByRole('heading', { name: 'Recommended' })
    expect(screen.getByRole('button', { name: 'More actions for Top ending' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Opening' }))

    expect(screen.getByRole('menu', { name: 'Opening actions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNext).toHaveBeenCalledTimes(1)
  })
})
