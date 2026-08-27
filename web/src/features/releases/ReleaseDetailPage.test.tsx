import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import type { MusicReleaseDto, MusicTrackDto } from '../../lib/library'
import { ReleaseDetailPage } from './ReleaseDetailPage'

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
    fileSize: null,
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
    tracks: [track(10, 'First Transmission'), track(11, 'Afterglow')],
    anime: [{ kitsuId: 'anime-1', title: 'Signal Breaker', titleEn: null, posterUrl: null, relationshipType: 'SOUNDTRACK' }],
    ...overrides,
  }
}

function renderPage(path = '/release/42') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/release/:releaseId" element={<ReleaseDetailPage />} /><Route path="*" element={<ReleaseDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(apiClient, 'get').mockReset()
})

describe('release detail page', () => {
  it('loads the release contract and exposes album playback actions', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(release())
    const onPlayAll = vi.fn()
    const onPlayTrack = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/release/42']}>
          <Routes><Route path="/release/:releaseId" element={<ReleaseDetailPage onPlayAll={onPlayAll} onPlayTrack={onPlayTrack} />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/loading release/i)
    expect(await screen.findByRole('heading', { name: 'Signal in the Static' })).toBeInTheDocument()
    expect(screen.getAllByText('Neon Harbor').length).toBeGreaterThan(0)
    expect(screen.getByText('SOUNDTRACK')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Signal Breaker' })).toHaveAttribute('href', '/anime/anime-1')
    expect(screen.getByText('First Transmission')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/music/releases/42', expect.anything())

    await userEvent.click(screen.getByRole('button', { name: 'Play all tracks' }))
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle release' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play Afterglow' }))
    expect(onPlayAll).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 42 }), false)
    expect(onPlayAll).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 42 }), true)
    expect(onPlayTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), expect.objectContaining({ id: 42 }), 1)
  })

  it('exposes the shared track actions on release rows with release context', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(release())
    renderPage()

    await screen.findByRole('heading', { name: 'Signal in the Static' })
    await userEvent.click(screen.getByRole('button', { name: 'More actions for First Transmission' }))

    expect(screen.getByRole('menuitem', { name: 'Play next' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Add to queue' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save to playlist' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Go to Neon Harbor' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Go to Signal Breaker' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Related Music' })).toBeInTheDocument()
  })

  it('renders an explicit empty state for a release without ready tracks', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(release({ tracks: [] }))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Signal in the Static' })).toBeInTheDocument()
    expect(screen.getByText(/no ready tracks/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play all tracks' })).toBeDisabled()
  })

  it('removes failed artwork instead of leaving browser broken-image text', async () => {
    vi.mocked(apiClient.get).mockResolvedValue(release({ artworkUrl: 'https://qa.invalid/missing.jpg' }))
    renderPage()

    const artwork = await screen.findByRole('img', { name: 'Signal in the Static artwork' })
    fireEvent.error(artwork)

    expect(screen.queryByRole('img', { name: 'Signal in the Static artwork' })).not.toBeInTheDocument()
  })

  it('renders a friendly sanitized error when the release request fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('authorization=secret-value token=private-token'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Release unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/could not load this release/i)).toBeInTheDocument()
    await userEvent.click(screen.getByText('Show technical details'))
    expect(screen.getByText('authorization: [redacted] token: [redacted]')).toBeInTheDocument()
    expect(screen.queryByText(/secret-value|private-token/)).not.toBeInTheDocument()
  })

  it('does not request a missing release id', () => {
    renderPage('/release/')
    expect(screen.getByRole('heading', { name: 'Release unavailable' })).toBeInTheDocument()
    expect(apiClient.get).not.toHaveBeenCalled()
  })
})
