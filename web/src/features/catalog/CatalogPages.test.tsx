import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { NormalizedLibrary } from '../../lib/library'

vi.mock('../../lib/query', () => ({
  useLibraryQuery: vi.fn(),
}))

import { useLibraryQuery } from '../../lib/query'
import { AnimeDetailPage, HomeCatalogPage, LibraryCatalogPage } from './index'

const library: NormalizedLibrary = {
  cursor: 10,
  animeById: {
    a: anime('a', 'Frieren: Beyond Journey’s End', 'TV'),
    b: anime('b', 'Bocchi the Rock!', 'completed'),
    c: anime('c', 'Cyberpunk: Edgerunners', 'current'),
  },
  themesById: {
    '1': theme(1, 'a', 'Opening'),
    '2': theme(2, 'a', 'Ending'),
    '3': theme(3, 'c', 'Opening'),
  },
  prefsByThemeId: {},
  songPrefsById: {},
  playlistsById: {},
  musicCatalogByAnimeId: {},
}

function anime(kitsuId: string, title: string, watchingStatus: string): NormalizedLibrary['animeById'][string] {
  return {
    kitsuId,
    animeThemesId: kitsuId === 'a' ? 11 : null,
    title,
    titleEn: title,
    titleRomaji: null,
    titleJa: null,
    posterUrl: `https://images.example/${kitsuId}.jpg`,
    coverUrl: null,
    watchingStatus,
    subtype: 'TV',
    startDate: null,
    endDate: null,
    episodeCount: 12,
    ageRating: null,
    averageRating: null,
    userRating: null,
    libraryUpdatedAt: 10,
    slug: kitsuId,
    genres: ['Drama'],
    updatedAt: 10,
    deleted: false,
  }
}

function theme(id: number, kitsuAnimeId: string, title: string): NormalizedLibrary['themesById'][string] {
  return {
    id,
    animeThemesAnimeId: kitsuAnimeId === 'a' ? 11 : 12,
    kitsuAnimeIds: [kitsuAnimeId],
    title,
    themeType: 'OP',
    artists: [],
    audioUrl: `/audio/${id}`,
    videoUrl: null,
    audioState: 'READY',
    durationSeconds: 90,
    fileSize: null,
    mediaModes: { tvSize: { url: `/audio/${id}`, durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
    updatedAt: 10,
    deleted: false,
  }
}

function renderWithQuery(ui: React.ReactElement, initialEntries = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>)
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

describe('catalog pages', () => {
  it('renders bounded home sections from the browser home projection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      serverTime: 10,
      continueWatching: [{ kitsuId: 'a', title: 'Frieren: Beyond Journey’s End', posterUrl: '/frieren.jpg', updatedAt: 10 }],
      recentlyAdded: [{ kitsuId: 'b', title: 'Bocchi the Rock!', posterUrl: '/bocchi.jpg', updatedAt: 9 }],
      playlists: [{ id: 7, name: 'Morning themes', itemCount: 4, isAuto: false, updatedAt: 10 }],
      nextCursor: null,
    })

    renderWithQuery(<HomeCatalogPage />)

    expect(await screen.findByRole('heading', { name: 'Continue watching' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Frieren/ })).toHaveAttribute('href', '/anime/a')
    expect(screen.getByRole('heading', { name: 'Recently added' })).toBeInTheDocument()
    expect(screen.getByText('Morning themes')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/home?limit=24', expect.anything())
  })

  it('filters and sorts a large library while rendering only the current page', async () => {
    const manyAnime = Object.fromEntries(Array.from({ length: 200 }, (_, index) => {
      const id = `anime-${index}`
      return [id, anime(id, `Show ${String(index).padStart(3, '0')}`, index % 2 === 0 ? 'current' : 'completed')]
    }))
    vi.mocked(useLibraryQuery).mockReturnValue({ library: { ...library, animeById: manyAnime }, status: 'success', isPending: false, isError: false, isSuccess: true, error: null } as never)
    renderWithQuery(<LibraryCatalogPage />)

    expect(screen.getAllByTestId('anime-card')).toHaveLength(24)
    expect(screen.queryByRole('link', { name: /Show 199/ })).not.toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Filter library' })
    await userEvent.type(search, 'Show 199')
    expect(screen.getAllByTestId('anime-card')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Show 199' })).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.click(screen.getByRole('button', { name: /Load more anime/ }))
    expect(screen.getAllByTestId('anime-card')).toHaveLength(48)
  })

  it('shows an empty library state when no anime matches the filter', async () => {
    renderWithQuery(<LibraryCatalogPage />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter library' }), 'does not exist')
    expect(screen.getByRole('heading', { name: 'No anime found' })).toBeInTheDocument()
    expect(screen.getByText(/Try a different search/)).toBeInTheDocument()
  })

  it('renders sanitized library loading and error states', () => {
    vi.mocked(useLibraryQuery).mockReturnValue({ status: 'pending', isPending: true, isError: false, isSuccess: false, error: null, library: null } as never)
    renderWithQuery(<LibraryCatalogPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your library')

    vi.mocked(useLibraryQuery).mockReturnValue({ status: 'error', isPending: false, isError: true, isSuccess: false, error: new Error('token=secret-value'), library: null } as never)
    renderWithQuery(<LibraryCatalogPage />)
    expect(screen.getByRole('heading', { name: 'Library unavailable' })).toBeInTheDocument()
    expect(screen.queryByText('secret-value')).not.toBeInTheDocument()
  })

  it('loads anime details and music through the existing detail contracts', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: anime('a', 'Frieren: Beyond Journey’s End', 'current'), themes: [theme(1, 'a', 'Opening')] })
      .mockResolvedValueOnce({ anime: { kitsuId: 'a', title: 'Frieren', titleEn: 'Frieren', posterUrl: '/frieren.jpg' }, releases: [{ id: 3, title: 'Season One', titleEnglish: null, titleRomaji: null, titleJapanese: null, artistCredit: 'Various', artistNames: [], relationshipType: 'THEME', releaseDate: null, year: 2024, artworkUrl: null, tracks: [] }] })

    renderWithQuery(<Routes><Route path="/anime/:animeId" element={<AnimeDetailPage />} /></Routes>, ['/anime/a'])

    expect(await screen.findByRole('heading', { name: 'Frieren: Beyond Journey’s End' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Themes' })).toBeInTheDocument()
    expect(screen.getByText('Season One')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/anime/a', expect.anything())
    expect(apiClient.get).toHaveBeenCalledWith('/v1/anime/a/music', expect.anything())
  })

  it('keeps detail themes and releases useful when either detail request is empty', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: anime('b', 'Bocchi the Rock!', 'completed'), themes: [] })
      .mockRejectedValueOnce(new Error('authorization=private'))

    renderWithQuery(<Routes><Route path="/anime/:animeId" element={<AnimeDetailPage />} /></Routes>, ['/anime/b'])

    expect(await screen.findByRole('heading', { name: 'Bocchi the Rock!' })).toBeInTheDocument()
    expect(screen.getByText('No themes are available for this anime yet.')).toBeInTheDocument()
    expect(screen.getByText('Music catalog unavailable')).toBeInTheDocument()
    expect(screen.queryByText('private')).not.toBeInTheDocument()
  })
})
