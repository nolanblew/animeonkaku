import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { useLibraryQuery } from '../../lib/query'
import { createEmptyLibrary, type NormalizedLibrary } from '../../lib/library'
import { SearchPage, findLibraryMatches, MAX_LIBRARY_RESULTS } from './SearchPage'
import { parseSearchResponse } from './search'

vi.mock('../../lib/api', () => ({
  apiClient: { get: vi.fn(), url: (value: string) => value.startsWith('/v1/') ? `/api${value}` : value },
}))

vi.mock('../../lib/query', async () => ({
  ...await vi.importActual<typeof import('../../lib/query')>('../../lib/query'),
  useLibraryQuery: vi.fn(),
}))

const mockedGet = vi.mocked(apiClient.get)
const mockedUseLibraryQuery = vi.mocked(useLibraryQuery)

function libraryWithRecords(): NormalizedLibrary {
  const library = createEmptyLibrary()
  return {
    ...library,
    animeById: {
      a1: {
        kitsuId: 'a1', animeThemesId: null, title: 'Naruto', titleEn: 'Naruto', titleRomaji: null,
        titleJa: null, posterUrl: '/v1/media/images/anime/a1/poster', coverUrl: null, watchingStatus: 'CURRENT', subtype: 'TV',
        startDate: null, endDate: null, episodeCount: 220, ageRating: null, averageRating: null,
        userRating: null, libraryUpdatedAt: null, slug: 'naruto', genres: ['Action'], updatedAt: 1, deleted: false,
      },
      deleted: {
        kitsuId: 'deleted', animeThemesId: null, title: 'Naruto Deleted', titleEn: null, titleRomaji: null,
        titleJa: null, posterUrl: null, coverUrl: null, watchingStatus: null, subtype: null,
        startDate: null, endDate: null, episodeCount: null, ageRating: null, averageRating: null,
        userRating: null, libraryUpdatedAt: null, slug: null, genres: [], updatedAt: 2, deleted: true,
      },
    },
    themesById: {
      '2': {
        id: 2, animeThemesAnimeId: 1, kitsuAnimeIds: ['a1'], title: 'Blue Bird', themeType: 'OP',
        artists: [{ name: 'Ikimonogakari', asCharacter: null, alias: null }], audioUrl: '/audio',
        videoUrl: null, audioState: 'READY', durationSeconds: 90, fileSize: null,
        mediaModes: { tvSize: { url: '/audio', durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
        updatedAt: 1, deleted: false,
      },
    },
    playlistsById: {
      '3': {
        id: 3, name: 'Naruto Favorites', entries: [2], defaultMode: 'TV_SIZE', overrideUserPreference: false,
        items: [{ entryId: 2, itemType: 'THEME', itemId: 2, modeOverride: null }], isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 1, deleted: false,
        dynamicSpecJson: null, dynamicSortJson: null,
      },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

beforeEach(() => {
  mockedGet.mockReset()
  mockedUseLibraryQuery.mockReturnValue({ library: libraryWithRecords() } as ReturnType<typeof useLibraryQuery>)
})

describe('findLibraryMatches', () => {
  it('matches active anime, themes, and playlists with per-kind bounds', () => {
    const library = libraryWithRecords()
    const matches = findLibraryMatches(library, 'naruto')

    expect(matches.anime).toHaveLength(1)
    expect(matches.anime[0].title).toBe('Naruto')
    expect(matches.playlists[0].name).toBe('Naruto Favorites')
    expect(matches.themes).toHaveLength(0)

    const large = { ...library, animeById: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index), { ...library.animeById.a1, kitsuId: String(index), title: `Naruto ${index}` }])) }
    expect(findLibraryMatches(large, 'naruto').anime).toHaveLength(MAX_LIBRARY_RESULTS.anime)
  })

  it('normalizes nested and malformed server payloads without throwing', () => {
    expect(parseSearchResponse({ music: { releases: [{ release: { title: 'Album' } }], tracks: [{ track: { title: 'Song' } }] } }).music.releases).toHaveLength(1)
    expect(parseSearchResponse({ releases: 'not an array', tracks: null }).music).toEqual({ releases: [], tracks: [] })
  })

  it('projects bounded AnimeThemes anime, songs, and artists from the server response', () => {
    const result = parseSearchResponse({
      animeThemes: { search: {
        anime: [{
          id: 91,
          name: 'Naruto',
          resources: [{ site: 'Kitsu', external_id: '11' }],
          images: [{ facet: 'Large Cover', link: 'https://img/naruto.jpg' }],
          animethemes: [{ id: 501, type: 'OP', sequence: 3, song: { title: 'Blue Bird', artists: [{ name: 'Ikimonogakari' }] } }],
        }],
        artists: [{ id: 7, name: 'Ikimonogakari', slug: 'ikimonogakari', images: [{ link: 'https://img/artist.jpg' }] }],
      } },
      music: { releases: [], tracks: [] },
    })

    expect(result.animeThemes.anime[0]).toMatchObject({ animeThemesId: 91, kitsuId: '11', name: 'Naruto', imageUrl: 'https://img/naruto.jpg', themeCount: 1 })
    expect(result.animeThemes.themes[0]).toMatchObject({ id: 501, animeName: 'Naruto', title: 'Blue Bird', themeType: 'OP3', artist: 'Ikimonogakari' })
    expect(result.animeThemes.artists[0]).toMatchObject({ id: 7, name: 'Ikimonogakari', slug: 'ikimonogakari', imageUrl: 'https://img/artist.jpg' })
  })
})

describe('SearchPage', () => {
  it('reads the router query, debounces the server request, and combines bounded local matches', async () => {
    vi.useFakeTimers()
    mockedGet.mockResolvedValue({
      animeThemes: { search: {
        anime: [{ id: 91, name: 'Naruto Shippuden', resources: [{ site: 'Kitsu', external_id: '12' }], images: [{ link: 'https://img/shippuden.jpg' }], animethemes: [{ id: 502, type: 'OP', sequence: 1, song: { title: 'Hero’s Come Back!!', artists: [{ name: 'nobodyknows+' }] } }] }],
        artists: [{ id: 8, name: 'nobodyknows+', slug: 'nobodyknows', images: [] }],
      } },
      tracks: [{ anime: { title: 'Naruto' }, releaseTitle: 'Best Collection', track: { id: 10, title: 'Blue Bird', artistCredit: 'Ikimonogakari', audioUrl: '/v1/media/songs/10/audio' } }],
      releases: [{ anime: [{ title: 'Naruto' }], release: { id: 20, title: 'Naruto Collection', artistCredit: 'Various', tracks: [] } }],
    })

    const onPlayTrack = vi.fn()
    render(<MemoryRouter initialEntries={['/search?q=naruto']}><SearchPage onPlayTrack={onPlayTrack} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByText('Naruto Favorites')).toBeInTheDocument()
    expect(mockedGet).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(mockedGet).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mockedGet).toHaveBeenCalledWith('/v1/search?q=naruto')
    await act(async () => { await vi.runAllTimersAsync(); await Promise.resolve() })
    expect(screen.getByText('Blue Bird')).toBeInTheDocument()
    expect(screen.getByText('Naruto Collection')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'In your library' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Discover on AnimeThemes' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Naruto Shippuden' })).toHaveAttribute('href', '/anime/12')
    expect(screen.getByText('Hero’s Come Back!!')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'nobodyknows+' })).toHaveAttribute('href', '/artist/nobodyknows')
    expect(screen.getByRole('button', { name: 'More actions for Blue Bird' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play Blue Bird' }))
    expect(onPlayTrack).toHaveBeenCalledWith(expect.objectContaining({ releaseTitle: 'Best Collection' }))
  })

  it('makes linked server release results navigable to release detail', async () => {
    vi.useFakeTimers()
    mockedGet.mockResolvedValue({ releases: [{ anime: [{ title: 'Naruto' }], release: { id: 20, title: 'Naruto Collection', artistCredit: 'Various', tracks: [] } }], tracks: [] })
    render(<MemoryRouter initialEntries={['/search?q=naruto']}><SearchPage /></MemoryRouter>)

    await act(async () => { await vi.advanceTimersByTimeAsync(300); await Promise.resolve() })
    expect(screen.getByRole('link', { name: 'Naruto Collection' })).toHaveAttribute('href', '/release/20')
  })

  it('links local anime and playlists and delegates local theme playback', () => {
    const library = libraryWithRecords()
    library.animeById.a1.title = 'Blue Naruto'
    library.animeById.a1.titleEn = 'Blue Naruto'
    library.playlistsById['3'].name = 'Blue Favorites'
    const onPlayTheme = vi.fn()
    mockedGet.mockResolvedValue({ releases: [], tracks: [] })
    render(<MemoryRouter initialEntries={['/search?q=blue']}><SearchPage library={library} onPlayTheme={onPlayTheme} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Blue Naruto' })).toHaveAttribute('href', '/anime/a1')
    expect(screen.getByRole('link', { name: 'Blue Favorites' })).toHaveAttribute('href', '/playlist/3')
    expect(screen.getByTestId('search-anime-a1').querySelector('img')).toHaveAttribute('src', '/api/v1/media/images/anime/a1/poster')
    expect(screen.getByTestId('search-theme-2').querySelector('img')).toHaveAttribute('src', '/api/v1/media/images/anime/a1/poster')
    expect(screen.getByTestId('search-playlist-3').querySelector('[data-layout="single"] img')).toHaveAttribute('src', '/api/v1/media/images/anime/a1/poster')
    fireEvent.click(screen.getByRole('button', { name: 'Play Blue Bird' }))
    expect(onPlayTheme).toHaveBeenCalledWith(expect.objectContaining({ id: 2, title: 'Blue Bird' }))
  })

  it('does not call the server for an empty query and explains the empty state', () => {
    render(<MemoryRouter initialEntries={['/search']}><SearchPage /></MemoryRouter>)
    expect(screen.getByText(/search your anime soundtrack/i)).toBeInTheDocument()
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('shows loading and a sanitized error without exposing raw service details', async () => {
    vi.useFakeTimers()
    let rejectRequest: ((reason?: unknown) => void) | undefined
    mockedGet.mockReturnValue(new Promise((_resolve, reject) => { rejectRequest = reject }))

    render(<MemoryRouter initialEntries={['/search?q=broken']}><SearchPage /></MemoryRouter>)
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(screen.getByRole('status')).toHaveTextContent(/searching/i)
    await act(async () => { rejectRequest?.(new Error('SQL password leaked')); await Promise.resolve() })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not complete search/i)
    expect(screen.queryByText(/SQL password leaked/i)).not.toBeInTheDocument()
  })

  it('shows a useful no-results state after an empty server response', async () => {
    vi.useFakeTimers()
    mockedGet.mockResolvedValue({ releases: [], tracks: [] })
    mockedUseLibraryQuery.mockReturnValue({ library: createEmptyLibrary() } as ReturnType<typeof useLibraryQuery>)
    render(<MemoryRouter initialEntries={['/search?q=unknown']}><SearchPage /></MemoryRouter>)
    await act(async () => { await vi.advanceTimersByTimeAsync(300); await Promise.resolve() })
    expect(screen.getByText(/no matches found/i)).toBeInTheDocument()
  })
})
