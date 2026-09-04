import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { LibraryAnimeDto, LibraryThemeDto, MusicReleaseDto, MusicTrackDto, NormalizedLibrary } from '../../lib/library'
import { useLibraryQuery } from '../../lib/query'
import { AnimeDetailPage } from './AnimeDetailPage'

vi.mock('../../lib/query', async () => ({
  ...await vi.importActual<typeof import('../../lib/query')>('../../lib/query'),
  useLibraryQuery: vi.fn(),
}))

const animeFixture: LibraryAnimeDto = {
  kitsuId: 'anime-1',
  animeThemesId: 101,
  title: 'Violet Evergarden',
  titleEn: 'Violet Evergarden',
  titleRomaji: null,
  titleJa: null,
  posterUrl: null,
  coverUrl: null,
  watchingStatus: 'current',
  subtype: 'TV',
  startDate: '2018-01-01',
  endDate: null,
  episodeCount: 13,
  ageRating: null,
  averageRating: null,
  userRating: null,
  libraryUpdatedAt: 1,
  slug: 'violet-evergarden',
  genres: ['Drama'],
  updatedAt: 1,
  deleted: false,
}

function theme(id: number, title: string, audioState: LibraryThemeDto['audioState'] = 'READY'): LibraryThemeDto {
  return {
    id,
    animeThemesAnimeId: 101,
    kitsuAnimeIds: ['anime-1'],
    title,
    themeType: id === 1 ? 'OP' : 'ED',
    artists: [{ name: 'TRUE', asCharacter: null, alias: null }],
    audioUrl: `/v1/media/audio/${id}`,
    videoUrl: null,
    audioState,
    durationSeconds: 90,
    fileSize: null,
    mediaModes: { tvSize: { url: `/v1/media/audio/${id}`, durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
    updatedAt: 1,
    deleted: false,
  }
}

function track(id: number, title: string, trackNumber: number): MusicTrackDto {
  return {
    id,
    title,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'TRUE',
    artistNames: [],
    durationSeconds: null,
    audioUrl: `/v1/media/songs/${id}/audio`,
    fileSize: null,
    discNumber: 1,
    trackNumber,
    displayOrder: trackNumber,
  }
}

function release(id: number, title: string, tracks: MusicTrackDto[]): MusicReleaseDto {
  return {
    id,
    title,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'TRUE',
    artistNames: [],
    relationshipType: 'ALBUM',
    releaseDate: '2024-02-03',
    year: 2024,
    artworkUrl: null,
    tracks,
  }
}

function emptyLibrary(): NormalizedLibrary {
  return {
    cursor: 1,
    animeById: {},
    themesById: {},
    prefsByThemeId: {},
    songPrefsById: {},
    playlistsById: {},
    musicCatalogByAnimeId: {},
  }
}

function renderDetail(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/anime/anime-1']}><Routes><Route path="/anime/:animeId" element={ui} /></Routes></MemoryRouter></QueryClientProvider>)
}

beforeEach(() => {
  vi.mocked(useLibraryQuery).mockReturnValue({
    status: 'success',
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    library: emptyLibrary(),
  } as never)
  vi.spyOn(apiClient, 'get').mockReset()
})

describe('anime detail feedback contracts', () => {
  it('uses icon-only theme play controls without exposing or gating on readiness state', async () => {
    const opening = theme(1, 'Sincerely')
    const ending = theme(2, 'Michishirube', 'PENDING')
    const onPlayThemes = vi.fn()
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: animeFixture, themes: [opening, ending] })
      .mockResolvedValueOnce({ anime: { kitsuId: 'anime-1', title: animeFixture.title, titleEn: animeFixture.titleEn, posterUrl: null }, releases: [] })

    renderDetail(<AnimeDetailPage onPlayThemes={onPlayThemes} />)

    const themes = await screen.findByRole('region', { name: 'Themes' })
    const rows = within(themes).getAllByRole('article')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const title = within(row).getByRole('heading').textContent
      const play = within(row).getByRole('button', { name: `Play ${title}` })
      expect(play).toHaveClass('catalog-theme-row__play')
      expect(play.textContent).toBe('')
      expect(play).not.toBeDisabled()
    }
    expect(within(themes).queryByText('Ready')).not.toBeInTheDocument()
    expect(within(themes).queryByText('Pending')).not.toBeInTheDocument()
    expect(within(themes).queryByTestId('theme-readiness')).not.toBeInTheDocument()

    const playAll = screen.getByRole('button', { name: /Play all/i })
    expect(playAll).not.toBeDisabled()
    await userEvent.click(playAll)
    expect(onPlayThemes).toHaveBeenCalledWith([opening, ending], 0, false, null)
  })

  it('renders each music release as a full-width section with release and track metadata', async () => {
    const firstRelease = release(1, 'Violet Evergarden Album', [track(11, 'Sincerely', 3), track(12, 'Michishirube', 4)])
    const secondRelease = release(2, 'Violet Evergarden Bonus', [track(13, 'Believe in...', 1)])
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: animeFixture, themes: [] })
      .mockResolvedValueOnce({ anime: { kitsuId: 'anime-1', title: animeFixture.title, titleEn: animeFixture.titleEn, posterUrl: null }, releases: [firstRelease, secondRelease] })

    renderDetail(<AnimeDetailPage />)

    await screen.findByRole('heading', { name: 'Violet Evergarden' })
    const releaseArticles = screen.getAllByRole('article').filter((article) => article.querySelector('h3 a'))
    expect(releaseArticles).toHaveLength(2)
    for (const article of releaseArticles) {
      expect(article).toHaveClass('catalog-release-section')
      expect(article).not.toHaveClass('catalog-release-card')
      expect(within(article).getByText('ALBUM')).toBeInTheDocument()
      const header = within(article.querySelector('.catalog-release-section__header') as HTMLElement)
      expect(header.getByText('TRUE')).toBeInTheDocument()
      expect(header.getByText(/2024/, { selector: 'small' })).toBeInTheDocument()
    }

    const firstTrackRow = document.querySelector('.catalog-release-track-row')
    expect(firstTrackRow).not.toBeNull()
    expect(firstTrackRow).toHaveTextContent('3')
    expect(within(firstTrackRow as HTMLElement).getByRole('button', { name: 'Play Sincerely' })).toBeInTheDocument()
    expect(document.querySelector('.catalog-release-grid')).not.toBeInTheDocument()
  })

  it('keeps artist navigation in anime track menus without redundant anime navigation', async () => {
    const song = track(11, 'Sincerely', 3)
    const album = release(1, 'Violet Evergarden Album', [song])
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ anime: animeFixture, themes: [] })
      .mockResolvedValueOnce({ anime: { kitsuId: 'anime-1', title: animeFixture.title, titleEn: animeFixture.titleEn, posterUrl: null }, releases: [album] })

    renderDetail(<AnimeDetailPage onPlayNextSong={vi.fn()} onAddToQueueSong={vi.fn()} onReplaceQueueSong={vi.fn()} />)

    await screen.findByRole('heading', { name: 'Violet Evergarden' })
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Sincerely' }))
    const menu = screen.getByRole('menu', { name: 'Sincerely actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Go to TRUE' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Go to Violet Evergarden' })).not.toBeInTheDocument()
  })
})
