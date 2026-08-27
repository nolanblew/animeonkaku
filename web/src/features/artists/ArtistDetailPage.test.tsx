import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

function renderPage(onPlayAll = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/artist/karuta']}>
        <Routes>
          <Route path="/artist/:artistSlug" element={<ArtistDetailPage onPlayAll={onPlayAll} />} />
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
    expect(screen.getByText('Ichiban no Takaramono')).toBeInTheDocument()
    expect(screen.getByText('Ichiban no Takaramono (Full Size)')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Signal Breaker' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Signal Breaker' })[0]).toHaveAttribute('href', '/anime/anime-1')
    expect(apiClient.get).toHaveBeenCalledWith('/v1/artists/karuta', expect.anything())
  })

  it('offers play and shuffle for the complete artist collection', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response)
    const onPlayAll = vi.fn()
    renderPage(onPlayAll)

    await screen.findByRole('heading', { name: 'Karuta' })
    await userEvent.click(screen.getByRole('button', { name: 'Play all' }))
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))

    expect(onPlayAll).toHaveBeenNthCalledWith(1, response, false)
    expect(onPlayAll).toHaveBeenNthCalledWith(2, response, true)
  })
})
