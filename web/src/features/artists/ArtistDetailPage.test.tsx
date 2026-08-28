import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { LibraryThemeDto, MusicTrackDto } from '../../lib/library'
import { ArtistDetailPage } from './ArtistDetailPage'

type ArtistAnimeLink = {
  kitsuId: string
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

const anime: ArtistAnimeLink = {
  kitsuId: 'anime-1',
  title: 'Signal Breaker',
  titleEn: 'Signal Breaker',
  posterUrl: '/v1/media/images/anime/anime-1/poster',
}

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
})

describe('artist detail page', () => {
  it('loads the artist contract with artwork, theme/full-song sections, and anime cross-links', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent(/loading artist/i)
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
    expect(apiClient.get).toHaveBeenCalledWith('/v1/artists/karuta', expect.anything())
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
    expect(screen.getByText('Available online')).toBeInTheDocument()
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
})
