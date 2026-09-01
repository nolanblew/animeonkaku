import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyLibrary } from '../lib/library'
import { LIBRARY_QUERY_KEY, queryClient } from '../lib/query'
import { apiClient } from '../lib/api'

const playerState = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => playerState.player }))

import { CurrentTrackActions } from './CurrentTrackActions'

describe('CurrentTrackActions preference subscription', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    playerState.player = {
      currentItem: { id: 44, itemType: 'THEME', themeId: 44, title: 'Opening Theme', artist: 'Neon Harbor', animeId: 'anime-44', videoUrl: '/video.mp4' },
      playItems: vi.fn(),
      queue: { playNext: vi.fn(), addToQueue: vi.fn() },
      setMode: vi.fn(),
      videoAvailable: true,
      fullSizeAvailable: true,
    }
    queryClient.clear()
    const library = createEmptyLibrary()
    queryClient.setQueryData(LIBRARY_QUERY_KEY, {
      ...library,
      prefsByThemeId: { '44': { themeId: 44, liked: false, disliked: false } },
    })
  })

  it('updates thumbs immediately when the normalized library preference changes', async () => {
    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument()

    act(() => {
      queryClient.setQueryData(LIBRARY_QUERY_KEY, (previous: ReturnType<typeof createEmptyLibrary>) => ({
        ...previous,
        prefsByThemeId: { '44': { themeId: 44, liked: true, disliked: false } },
      }))
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove like' })).toBeInTheDocument())
  })

  it('updates the whole-theme preference while video playback is active', async () => {
    playerState.player.currentItem = { ...playerState.player.currentItem, mode: 'VIDEO' }
    let resolveRequest!: (value: unknown) => void
    const pendingRequest = new Promise((resolve) => { resolveRequest = resolve })
    const request = vi.spyOn(apiClient, 'request').mockReturnValue(pendingRequest as never)

    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove like' })).toHaveAttribute('aria-pressed', 'true'))
    expect(request).toHaveBeenCalledWith('/v1/prefs/themes/44', expect.objectContaining({ body: JSON.stringify({ liked: true }) }))
    resolveRequest({ themeId: 44, liked: true, disliked: false })
  })

  it('persists toggle state and immediately advances after adding a dislike', async () => {
    const request = vi.spyOn(apiClient, 'request').mockImplementation(async (_path, options) => ({
      themeId: 44,
      liked: JSON.parse(String(options?.body)).liked ?? false,
      disliked: JSON.parse(String(options?.body)).disliked ?? false,
    }) as never)
    playerState.player.next = vi.fn().mockResolvedValue(undefined)

    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove like' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove like' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute('aria-pressed', 'false'))

    fireEvent.click(screen.getByRole('button', { name: 'Dislike' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove dislike' })).toHaveAttribute('aria-pressed', 'true'))
    expect(playerState.player.next).toHaveBeenCalledOnce()
    expect(request.mock.calls.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { liked: true },
      { liked: false },
      { disliked: true },
    ])
  })

  it('omits duplicate queue actions for the track that is already playing', () => {
    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening Theme' }))

    expect(screen.queryByRole('menuitem', { name: 'Play next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add to queue' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
  })

  it('renders the overflow menu at the viewport layer so player clipping cannot hide it', () => {
    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening Theme' }))

    const menu = screen.getByRole('menu', { name: 'Opening Theme actions' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('viewport-menu')
  })

  it('executes video, discovery, and preferred-mode callbacks through the router', async () => {
    const request = vi.spyOn(apiClient, 'request').mockImplementation(async () => ({}) as never)
    function LocationProbe() {
      return <output data-testid="location">{useLocation().pathname}</output>
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/player']}>
          <Routes><Route path="*" element={<><CurrentTrackActions /><LocationProbe /></>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const open = () => fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening Theme' }))
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play Video' }))
    expect(playerState.player.setMode).toHaveBeenCalledWith('VIDEO')

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to artist' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/artist/neon-harbor')

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to anime' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/anime/anime-44')

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Related Music' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/anime/anime-44/related-music')

    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Prefer Full Size' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/themes/44', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredMode: 'FULL_SIZE' }),
    }))
  })

  it('uses the browser-history fallback when no router context is available', () => {
    window.history.replaceState({}, '', '/player')
    render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening Theme' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to anime' }))

    expect(window.location.pathname).toBe('/anime/anime-44')
  })

  it('renders no menu for an absent or invalid current queue item', () => {
    playerState.player.currentItem = undefined
    const { rerender } = render(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()

    playerState.player.currentItem = { id: 'not-a-number', itemType: 'THEME', title: 'Invalid' }
    rerender(<QueryClientProvider client={queryClient}><CurrentTrackActions /></QueryClientProvider>)
    expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument()
  })
})
