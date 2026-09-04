import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../lib/api'
import { createEmptyLibrary, type LibraryThemeDto, type MusicReleaseDto, type MusicTrackDto, type NormalizedLibrary, type PlaylistDto } from '../lib/library'
import { AnimeDetailPage } from './catalog/AnimeDetailPage'
import { PlaylistDetail } from './playlists/components'
import { ReleaseDetailPage } from './releases/ReleaseDetailPage'

vi.mock('../lib/query', async () => ({
  ...await vi.importActual<typeof import('../lib/query')>('../lib/query'),
  useLibraryQuery: () => ({ library: playlistLibrary(), status: 'success', isPending: false, isError: false, isSuccess: true, error: null }),
}))

function renderWithQuery(ui: React.ReactElement, initialEntries: string[] = ['/']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter></QueryClientProvider>)
}

function track(overrides: Partial<MusicTrackDto> = {}): MusicTrackDto {
  return {
    id: 401,
    title: 'Signal in Violet (Full)',
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Neon Harbor',
    artistNames: [],
    durationSeconds: null,
    audioUrl: '/v1/media/songs/401/audio',
    fileSize: null,
    discNumber: 1,
    trackNumber: 1,
    displayOrder: 1,
    ...overrides,
  }
}

function release(overrides: Partial<MusicReleaseDto> = {}): MusicReleaseDto {
  return {
    id: 4,
    title: 'Runtime QA Anthology',
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Neon Harbor',
    artistNames: [],
    relationshipType: 'SOUNDTRACK',
    releaseDate: null,
    year: null,
    artworkUrl: null,
    tracks: [track()],
    anime: [{ kitsuId: 'anime-9', title: 'Runtime QA Anthology', titleEn: null, posterUrl: null, relationshipType: 'SOUNDTRACK' }],
    ...overrides,
  }
}

function theme(): LibraryThemeDto {
  return {
    id: 41,
    animeThemesAnimeId: 9,
    kitsuAnimeIds: ['anime-9'],
    title: 'Signal in Violet',
    themeType: 'OP1',
    artists: [],
    audioUrl: '/v1/media/audio/41',
    videoUrl: null,
    audioState: 'READY',
    durationSeconds: null,
    fileSize: null,
    mediaModes: { tvSize: { url: '/v1/media/audio/41', durationSeconds: null, fileSize: null }, fullSize: null, video: null },
    updatedAt: 1,
    deleted: false,
  }
}

function playlistLibrary(): NormalizedLibrary {
  const base = createEmptyLibrary()
  return {
    ...base,
    animeById: {
      'anime-9': {
        kitsuId: 'anime-9', animeThemesId: 9, title: 'Runtime QA Anthology', titleEn: 'Runtime QA Anthology', titleRomaji: null, titleJa: null,
        posterUrl: null, coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null, endDate: null, episodeCount: 12,
        ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1, slug: 'runtime-qa-anthology', genres: [], updatedAt: 1, deleted: false,
      },
    },
    themesById: { '41': theme() },
  }
}

function playlist(): PlaylistDto {
  return {
    id: 7,
    name: 'Runtime QA queue',
    entries: [41],
    defaultMode: 'TV_SIZE',
    overrideUserPreference: false,
    items: [{ entryId: 70, itemType: 'THEME', itemId: 41, modeOverride: null }],
    isAuto: false,
    isDynamic: false,
    autoUpdate: false,
    updatedAt: 1,
    deleted: false,
    dynamicSpecJson: null,
    dynamicSortJson: null,
  }
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockReset()
})

describe('phase 4 missing-duration presentation', () => {
  it('omits a release-row duration when the catalog has no duration metadata', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(release())
    renderWithQuery(<Routes><Route path="/release/:releaseId" element={<ReleaseDetailPage />} /></Routes>, ['/release/4'])

    expect(await screen.findByRole('heading', { name: 'Runtime QA Anthology', level: 1 })).toBeInTheDocument()
    expect(document.querySelector('.release-track-list__duration')).not.toBeInTheDocument()
    expect(screen.queryByText('--:--')).not.toBeInTheDocument()
  })

  it('omits a playlist-row duration when the theme has no duration metadata', () => {
    renderWithQuery(<PlaylistDetail playlist={playlist()} library={playlistLibrary()} onUpdate={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.getByText('Signal in Violet')).toBeInTheDocument()
    expect(document.querySelector('.playlist-track-row time')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('omits an anime release-track duration when the full-song catalog has no duration metadata', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: playlistLibrary().animeById['anime-9'], themes: [] })
      .mockResolvedValueOnce({ anime: { kitsuId: 'anime-9', title: 'Runtime QA Anthology', titleEn: null, posterUrl: null }, releases: [release()] })
    renderWithQuery(<Routes><Route path="/anime/:animeId" element={<AnimeDetailPage />} /></Routes>, ['/anime/anime-9'])

    expect(await screen.findByRole('heading', { name: 'Runtime QA Anthology', level: 1 })).toBeInTheDocument()
    expect(document.querySelector('.catalog-release-track-row time')).not.toBeInTheDocument()
    expect(screen.queryByText('--:--')).not.toBeInTheDocument()
  })
})
