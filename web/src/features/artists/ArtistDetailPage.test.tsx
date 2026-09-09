import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { LibraryThemeDto, MusicTrackDto } from '../../lib/library'
import { ArtistDetailPage } from './ArtistDetailPage'

type ArtistAnimeLink = {
  kitsuId: string | null
  animeThemesAnimeId?: number | null
  title: string
  titleEn: string | null
  posterUrl: string | null
}

type ArtistThemeDto = LibraryThemeDto & { anime: ArtistAnimeLink[] }
type ArtistFullSongDto = MusicTrackDto & {
  releaseId: number
  releaseTitle: string
  anime: ArtistAnimeLink[]
}

type ArtistDetailResponse = {
  artist: {
    id: number
    name: string
    slug: string
    artworkUrl: string | null
  }
  themes: ArtistThemeDto[]
  fullSongs: ArtistFullSongDto[]
}

const anime = {
  kitsuId: 'anime-1',
  title: 'Signal Breaker',
  titleEn: 'Signal Breaker',
  posterUrl: '/v1/media/images/anime/anime-1/poster',
} satisfies ArtistAnimeLink

const themes: ArtistThemeDto[] = [{
  id: 2222,
  animeThemesAnimeId: 2984,
  kitsuAnimeIds: [anime.kitsuId],
  title: 'Ichiban no Takaramono',
  themeType: 'ED1',
  artists: [{ name: 'Karuta', asCharacter: null, alias: null }],
  audioUrl: '/v1/media/audio/2222',
  videoUrl: null,
  audioState: 'READY',
  durationSeconds: 265,
  fileSize: 1_024_000,
  mediaModes: {
    tvSize: { url: '/v1/media/audio/2222', durationSeconds: 90, fileSize: 400_000 },
    fullSize: { songId: 700, url: '/v1/media/songs/700/audio', durationSeconds: 265, fileSize: 1_024_000, sourceReleaseId: 42 },
    video: null,
  },
  updatedAt: 1,
  deleted: false,
  anime: [anime],
}]

const fullSongs: ArtistFullSongDto[] = [{
  id: 700,
  title: 'Ichiban no Takaramono (Full Size)',
  titleEnglish: null,
  titleRomaji: null,
  titleJapanese: null,
  artistCredit: 'Karuta',
  artistNames: [{ english: 'Karuta' }],
  durationSeconds: 265,
  audioUrl: '/v1/media/songs/700/audio',
  fileSize: 1_024_000,
  discNumber: 1,
  trackNumber: 1,
  displayOrder: 1,
  releaseId: 42,
  releaseTitle: 'Signal in the Static',
  anime: [anime],
}]

const response: ArtistDetailResponse = {
  artist: {
    id: 7,
    name: 'Karuta',
    slug: 'karuta',
    artworkUrl: 'https://images.example/karuta.jpg',
  },
  themes,
  fullSongs,
}

function renderPage(
  onPlayAll = vi.fn(),
  onPlayItem = vi.fn(),
  onPlayNextItem = vi.fn(),
  onAddToQueueItem = vi.fn(),
  onPlayNextAll = vi.fn(),
  onAddToQueueAll = vi.fn(),
  onReplaceQueueAll = vi.fn(),
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/artist/karuta']}>
        <Routes>
          <Route path="/artist/:artistSlug" element={<ArtistDetailPage onPlayAll={onPlayAll} onPlayItem={onPlayItem} onPlayNextItem={onPlayNextItem} onAddToQueueItem={onAddToQueueItem} onPlayNextAll={onPlayNextAll} onAddToQueueAll={onAddToQueueAll} onReplaceQueueAll={onReplaceQueueAll} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockReset()
  vi.spyOn(apiClient, 'post').mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('artist detail page', () => {
  it('loads the artist contract with artwork, theme/full-song sections, and anime cross-links', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent(/finding this artist/i)
    expect(await screen.findByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Karuta artwork' })).toHaveAttribute('src', response.artist.artworkUrl)
    expect(screen.getByRole('heading', { name: /themes/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /full songs/i })).toBeInTheDocument()
    expect(screen.getByText('Ichiban no Takaramono · Karuta')).toBeInTheDocument()
    expect(screen.getByText('Ichiban no Takaramono (Full Size)')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Signal Breaker' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Signal Breaker' })[0]).toHaveAttribute('href', '/anime/anime-1')
    fireEvent.error(screen.getByRole('img', { name: 'Karuta artwork' }))
    expect(screen.queryByRole('img', { name: 'Karuta artwork' })).not.toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/artists/karuta/catalog', expect.anything())
  })

  it('shows anime artwork and an identifiable anime relationship for themes and full songs', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    renderPage()

    await screen.findByRole('heading', { name: 'Karuta' })

    expect(screen.getByText('1 Themes')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    const themeRow = rows[0]!
    const songRow = rows[1]!
    expect(within(themeRow).getByRole('button', { name: 'Play Ichiban no Takaramono' })).toBeInTheDocument()
    expect(within(themeRow).getByRole('img', { name: 'Signal Breaker cover' })).toHaveAttribute('src', '/api/v1/media/images/anime/anime-1/poster')
    expect(within(themeRow).getByRole('link', { name: 'Signal Breaker' })).toBeInTheDocument()
    expect(within(songRow).getByRole('img', { name: 'Signal Breaker cover' })).toHaveAttribute('src', '/api/v1/media/images/anime/anime-1/poster')
    expect(within(songRow).getByRole('link', { name: 'Signal Breaker' })).toBeInTheDocument()
  })

  it('keeps no-Kitsu anime artwork and title visible without inventing an anime link', async () => {
    const noKitsuAnime: ArtistAnimeLink = {
      kitsuId: null,
      animeThemesAnimeId: 4885,
      title: 'Rich Girl Caretaker',
      titleEn: 'The Rich Girl Caretaker',
      posterUrl: '/v1/media/images/anime/rich-girl-caretaker/poster',
    }
    vi.mocked(apiClient.get).mockResolvedValue({
      ...response,
      themes: [{ ...themes[0], kitsuAnimeIds: [], animeThemesAnimeId: 4885, anime: [noKitsuAnime] }],
      fullSongs: [{ ...fullSongs[0], anime: [noKitsuAnime] }],
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Karuta' })

    const rows = screen.getAllByRole('listitem')
    expect(screen.getByText('1 Themes')).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('img', { name: 'Rich Girl Caretaker cover' })).toHaveAttribute('src', '/api/v1/media/images/anime/rich-girl-caretaker/poster')
    expect(within(rows[0]!).getByText(/Rich Girl Caretaker/)).toBeInTheDocument()
    expect(within(rows[0]!).queryByRole('link', { name: /Rich Girl Caretaker/ })).not.toBeInTheDocument()
    expect(within(rows[1]!).getByRole('img', { name: 'Rich Girl Caretaker cover' })).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Rich Girl Caretaker/)).toBeInTheDocument()
  })

  it('offers play and shuffle for the complete artist collection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    const onPlayAll = vi.fn()
    const onPlayItem = vi.fn()
    renderPage(onPlayAll, onPlayItem)

    await screen.findByRole('heading', { name: 'Karuta' })
    await userEvent.click(screen.getByRole('button', { name: 'Play all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play Ichiban no Takaramono' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play Ichiban no Takaramono (Full Size)' }))

    expect(onPlayAll).toHaveBeenNthCalledWith(1, response, false)
    expect(onPlayAll).toHaveBeenNthCalledWith(2, response, true)
    expect(onPlayItem).toHaveBeenNthCalledWith(1, response, 0)
    expect(onPlayItem).toHaveBeenNthCalledWith(2, response, 1)
  })

  it('keeps play and shuffle prominent while grouping artist collection actions under More', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    const onPlayNextAll = vi.fn()
    const onAddToQueueAll = vi.fn()
    const onReplaceQueueAll = vi.fn()
    renderPage(vi.fn(), vi.fn(), vi.fn(), vi.fn(), onPlayNextAll, onAddToQueueAll, onReplaceQueueAll)

    await screen.findByRole('heading', { name: 'Karuta' })
    expect(screen.getByRole('button', { name: 'Play all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Karuta' }))
    const menu = screen.getByRole('menu', { name: 'Karuta actions' })
    expect(within(menu).getByRole('menuitem', { name: 'Play next' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Add to queue' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Add to playlist' })).toBeInTheDocument()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNextAll).toHaveBeenCalledWith(response)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Karuta' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))
    expect(onAddToQueueAll).toHaveBeenCalledWith(response)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Karuta' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Replace queue' }))
    expect(onReplaceQueueAll).toHaveBeenCalledWith(response)
  })

  it('offers shared overflow actions for every artist theme and full-song row', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    const onPlayNextItem = vi.fn()
    const onAddToQueueItem = vi.fn()
    renderPage(vi.fn(), vi.fn(), onPlayNextItem, onAddToQueueItem)

    await screen.findByRole('heading', { name: 'Karuta' })
    expect(screen.getByRole('button', { name: 'More actions for Ichiban no Takaramono' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Ichiban no Takaramono (Full Size)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Ichiban no Takaramono (Full Size)' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))

    expect(onPlayNextItem).toHaveBeenCalledWith(response, 1)
    expect(onAddToQueueItem).toHaveBeenCalledWith(response, 1)
  })

  it('renders fallback artist rows for incomplete theme and song metadata', async () => {
    const fallbackTheme = {
      ...themes[0],
      title: 'Unmatched theme',
      themeType: null,
      artists: [],
      audioUrl: '',
      audioState: undefined,
      anime: undefined,
      kitsuAnimeIds: ['anime-without-title'],
    }
    const metadataSong = {
      ...fullSongs[0],
      title: 'Metadata only',
      audioUrl: undefined,
      audioAvailable: false,
      artistCredit: '',
      releaseId: null,
      releaseTitle: null,
      anime: [],
    }
    vi.mocked(apiClient.get).mockResolvedValue({
      artist: { ...response.artist, name: ' ', artworkUrl: null },
      themes: [fallbackTheme],
      fullSongs: [metadataSong],
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Unknown artist' })).toBeInTheDocument()
    expect(screen.getAllByText('Unmatched theme')).toHaveLength(2)
    expect(screen.queryByText('Available online')).not.toBeInTheDocument()
    expect(screen.getAllByText('Metadata only')).toHaveLength(2)
    expect(screen.getAllByText('Unknown artist')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Play Metadata only' })).toBeDisabled()
  })

  it('retries after the artist endpoint fails', async () => {
    let calls = 0
    vi.mocked(apiClient.get).mockImplementation(async () => {
      calls += 1
      if (calls === 1) throw new Error('artist unavailable')
      return response
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Artist unavailable' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('keeps the artist-shaped loading state while polling a cold catalog', async () => {
    vi.useFakeTimers()
    const loading = { ...response, themes: [], fullSongs: [], catalogState: { status: 'loading' as const, hasData: false, lastUpdatedAt: null } }
    const ready = { ...response, catalogState: { status: 'ready' as const, hasData: true, lastUpdatedAt: '2026-09-08T22:00:00Z' } }
    let calls = 0
    vi.mocked(apiClient.get).mockImplementation(async () => {
      calls += 1
      return calls === 1 ? loading : ready
    })

    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/finding this artist/i)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByRole('status')).toHaveTextContent(/finding this artist|preparing anime artwork/i)

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('keeps cached content visible when a background refresh fails and stops polling', async () => {
    vi.useFakeTimers()
    const refreshing = { ...response, catalogState: { status: 'refreshing' as const, hasData: true, lastUpdatedAt: '2026-09-08T21:00:00Z' } }
    vi.mocked(apiClient.get).mockResolvedValueOnce(refreshing).mockRejectedValueOnce(new Error('artwork provider unavailable'))

    renderPage()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(screen.getByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be refreshed/i)
    expect(screen.getByText('Ichiban no Takaramono · Karuta')).toBeInTheDocument()
    const callsAfterFailure = vi.mocked(apiClient.get).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(vi.mocked(apiClient.get).mock.calls.length).toBe(callsAfterFailure)
  })

  it('offers the explicit catalog refresh contract for a no-data error', async () => {
    const failed = { ...response, themes: [], fullSongs: [], catalogState: { status: 'error' as const, hasData: false, lastUpdatedAt: null } }
    vi.mocked(apiClient.get).mockResolvedValueOnce(failed).mockResolvedValueOnce(response)
    vi.mocked(apiClient.post).mockResolvedValue(failed)

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Artist music unavailable' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(apiClient.post).toHaveBeenCalledWith('/v1/artists/karuta/catalog/refresh')
    expect(await screen.findByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
  })

  it('shows a retry failure and disables the no-data retry while it is pending', async () => {
    const failed = { ...response, themes: [], fullSongs: [], catalogState: { status: 'error' as const, hasData: false, lastUpdatedAt: null } }
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    vi.mocked(apiClient.get).mockResolvedValue(failed)
    vi.mocked(apiClient.post).mockImplementation(() => new Promise<ArtistDetailResponse>((_resolve, reject) => { rejectRefresh = reject }))

    renderPage()

    await screen.findByRole('heading', { name: 'Artist music unavailable' })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled())

    await act(async () => { rejectRefresh?.(new Error('refresh unavailable')) })
    expect(await screen.findByText(/could not start the catalog refresh/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeDisabled()
  })

  it('does not let an old artist retry update a newly selected artist', async () => {
    const failed = { ...response, themes: [], fullSongs: [], catalogState: { status: 'error' as const, hasData: false, lastUpdatedAt: null } }
    const loadingOther = { ...response, artist: { ...response.artist, name: 'Other Artist', slug: 'other', artworkUrl: 'https://images.example/other.jpg' }, themes: [], fullSongs: [], catalogState: { status: 'loading' as const, hasData: false, lastUpdatedAt: null } }
    let rejectRefresh: ((reason?: unknown) => void) | undefined
    vi.mocked(apiClient.get).mockImplementation(async (path) => path === '/v1/artists/karuta/catalog' ? failed : loadingOther)
    vi.mocked(apiClient.post).mockImplementation(() => new Promise<ArtistDetailResponse>((_resolve, reject) => { rejectRefresh = reject }))

    function RouteSwitcher() {
      const navigate = useNavigate()
      return <><button type="button" onClick={() => navigate('/artist/other')}>Switch artist</button><ArtistDetailPage /></>
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/artist/karuta']}><Routes><Route path="/artist/:artistSlug" element={<RouteSwitcher />} /></Routes></MemoryRouter></QueryClientProvider>)

    await screen.findByRole('heading', { name: 'Artist music unavailable' })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Retrying…' })
    await userEvent.click(screen.getByRole('button', { name: 'Switch artist' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/finding this artist/i)

    await act(async () => { rejectRefresh?.(new Error('old artist refresh unavailable')) })
    expect(screen.queryByRole('heading', { name: 'Artist music unavailable' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/finding this artist/i)
  })

  it('retries artist artwork when the artwork URL changes', async () => {
    const other = { ...response, artist: { ...response.artist, name: 'Other Artist', slug: 'other', artworkUrl: 'https://images.example/other.jpg' } }
    vi.mocked(apiClient.get).mockImplementation(async (path) => path === '/v1/artists/karuta/catalog' ? response : other)

    function RouteSwitcher() {
      const navigate = useNavigate()
      return <><button type="button" onClick={() => navigate('/artist/other')}>Switch artist</button><ArtistDetailPage /></>
    }

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/artist/karuta']}><Routes><Route path="/artist/:artistSlug" element={<RouteSwitcher />} /></Routes></MemoryRouter></QueryClientProvider>)

    const oldArtwork = await screen.findByRole('img', { name: 'Karuta artwork' })
    fireEvent.error(oldArtwork)
    expect(screen.queryByRole('img', { name: 'Karuta artwork' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch artist' }))

    expect(await screen.findByRole('img', { name: 'Other Artist artwork' })).toHaveAttribute('src', 'https://images.example/other.jpg')
  })

  it('does not keep the previous artist visible after a route change', async () => {
    function RouteSwitcher() {
      const navigate = useNavigate()
      return <><button type="button" onClick={() => navigate('/artist/other')}>Switch artist</button><ArtistDetailPage /></>
    }
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/artists/karuta/catalog') return response
      return new Promise(() => undefined)
    })

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/artist/karuta']}><Routes><Route path="/artist/:artistSlug" element={<RouteSwitcher />} /></Routes></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', { name: 'Karuta' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch artist' }))

    expect(screen.queryByRole('heading', { name: 'Karuta' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/finding this artist/i)
    expect(apiClient.get).toHaveBeenLastCalledWith('/v1/artists/other/catalog', expect.anything())
  })
})
