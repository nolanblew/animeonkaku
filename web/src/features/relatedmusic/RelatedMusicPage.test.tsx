import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { AnimeMusicDto, MusicReleaseDto, MusicTrackDto } from '../../lib/library'
import { RelatedMusicPage } from './RelatedMusicPage'

type RequestScopeStatus = {
  scope: 'FULL_SONGS' | 'EXTRA_MUSIC'
  active: boolean
  eligibleCount: number
  availableCount: number
  missingCount: number
  latest: {
    id: string
    state: string
    requestedAt: string
  } | null
}

type MusicRequestStatusResponse = {
  kitsuId: string
  scopes: RequestScopeStatus[]
}

type MusicRequestResponse = {
  request: {
    id: string
    scope: 'FULL_SONGS' | 'EXTRA_MUSIC'
    state: 'QUEUED' | 'SEARCHING' | 'DOWNLOADING' | 'PROCESSING' | 'COMPLETED'
    requestedAt: string
  }
  replayed: boolean
}

function track(id: number, title: string): MusicTrackDto {
  return {
    id,
    title,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Neon Harbor',
    artistNames: [],
    durationSeconds: 204,
    audioUrl: `/v1/media/songs/${id}/audio`,
    fileSize: 1_024_000,
    discNumber: 1,
    trackNumber: id - 9,
    displayOrder: id - 9,
  }
}

function release(overrides: Partial<MusicReleaseDto> = {}): MusicReleaseDto {
  return {
    id: 42,
    title: 'Signal in the Static',
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Neon Harbor',
    artistNames: [],
    relationshipType: 'SOUNDTRACK',
    releaseDate: '2024-06-18',
    year: 2024,
    artworkUrl: '/v1/media/images/releases/42/artwork',
    tracks: [track(10, 'First Transmission')],
    anime: [{ kitsuId: 'anime-1', title: 'Signal Breaker', titleEn: null, posterUrl: null, relationshipType: 'SOUNDTRACK' }],
    ...overrides,
  }
}

const music: AnimeMusicDto = {
  anime: { kitsuId: 'anime-1', title: 'Signal Breaker', titleEn: null, posterUrl: '/v1/media/images/anime/anime-1/poster' },
  releases: [release()],
}

const status: MusicRequestStatusResponse = {
  kitsuId: 'anime-1',
  scopes: [
    { scope: 'FULL_SONGS', active: false, eligibleCount: 3, availableCount: 1, missingCount: 2, latest: null },
    { scope: 'EXTRA_MUSIC', active: false, eligibleCount: 1, availableCount: 1, missingCount: 0, latest: null },
  ],
}

function renderPage(onOpenRelease?: (release: MusicReleaseDto) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/anime/anime-1/related-music']}>
        <Routes>
          <Route path="/anime/:kitsuId/related-music" element={<RelatedMusicPage onOpenRelease={onOpenRelease} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderInvalidPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/related']}>
        <Routes><Route path="/related" element={<RelatedMusicPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockReset()
  vi.spyOn(apiClient, 'post').mockReset()
})

describe('related music page', () => {
  it('discovers releases, links to the existing release detail, and exposes request status', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/anime/anime-1/music') return music
      if (path === '/v1/anime/anime-1/music-requests/status') return status
      throw new Error(`Unexpected GET ${path}`)
    })
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent(/loading related music/i)
    expect(await screen.findByRole('heading', { name: 'Related Music' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Signal in the Static' })).toHaveAttribute('href', '/release/42')
    expect(screen.getByText(/2 missing full songs/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request Full Songs' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Request Extra Music' })).toBeDisabled()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/anime/anime-1/music', expect.anything())
    expect(apiClient.get).toHaveBeenCalledWith('/v1/anime/anime-1/music-requests/status', expect.anything())
  })

  it('submits a full-song request and surfaces the queued state without replacing release discovery', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/anime/anime-1/music') return music
      if (path === '/v1/anime/anime-1/music-requests/status') return status
      throw new Error(`Unexpected GET ${path}`)
    })
    const queued: MusicRequestResponse = {
      request: { id: 'request-1', scope: 'FULL_SONGS', state: 'QUEUED', requestedAt: '2026-08-27T12:00:00Z' },
      replayed: false,
    }
    vi.mocked(apiClient.post).mockResolvedValue(queued)
    renderPage()

    await screen.findByRole('heading', { name: 'Related Music' })
    await userEvent.click(screen.getByRole('button', { name: 'Request Full Songs' }))

    expect(apiClient.post).toHaveBeenCalledWith('/v1/anime/anime-1/music-requests/full-songs')
    expect(await screen.findByText(/full-song request queued/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Signal in the Static' })).toHaveAttribute('href', '/release/42')
  })

  it('retries the related-music request after the discovery endpoint fails', async () => {
    let musicCalls = 0
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/anime/anime-1/music') {
        musicCalls += 1
        if (musicCalls === 1) throw new Error('discovery unavailable')
        return music
      }
      if (path === '/v1/anime/anime-1/music-requests/status') return status
      throw new Error(`Unexpected GET ${path}`)
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Related music unavailable' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Related Music' })).toBeInTheDocument()
    expect(musicCalls).toBe(2)
  })

  it('surfaces request-status failures and retries the status query', async () => {
    let statusCalls = 0
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/anime/anime-1/music') return music
      if (path === '/v1/anime/anime-1/music-requests/status') {
        statusCalls += 1
        if (statusCalls === 1) throw new Error('status unavailable')
        return status
      }
      throw new Error(`Unexpected GET ${path}`)
    })
    renderPage()

    expect(await screen.findByText(/Could not load request status/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request Full Songs' })).toBeEnabled())
    expect(statusCalls).toBe(2)
  })

  it('reports provider request errors and forwards release-card activation', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/v1/anime/anime-1/music') return music
      if (path === '/v1/anime/anime-1/music-requests/status') return status
      throw new Error(`Unexpected GET ${path}`)
    })
    vi.mocked(apiClient.post).mockRejectedValue(new Error('provider unavailable'))
    const onOpenRelease = vi.fn()
    renderPage(onOpenRelease)

    await screen.findByRole('heading', { name: 'Related Music' })
    await userEvent.click(screen.getByRole('button', { name: 'Request Full Songs' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('provider unavailable')

    await userEvent.click(screen.getByRole('link', { name: 'Signal in the Static' }))
    expect(onOpenRelease).toHaveBeenCalledWith(music.releases[0])
  })

  it('rejects a route without an anime identifier before making requests', () => {
    renderInvalidPage()

    expect(screen.getByRole('heading', { name: 'Related music unavailable' })).toBeInTheDocument()
    expect(apiClient.get).not.toHaveBeenCalled()
  })
})
