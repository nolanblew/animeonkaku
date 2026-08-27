import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => state.player }))

import { MiniPlayerView } from './MiniPlayerView'
import { NowPlayingView } from './NowPlayingView'

beforeEach(() => {
  state.player = {
    currentItem: { id: 1, title: 'Opening', artist: 'Band', artworkUrl: '/art.jpg', durationMs: 90_000 },
    currentTime: 65,
    duration: 90,
    mode: 'VIDEO',
    isPlaying: false,
    isLoading: true,
    error: 'Recoverable error',
    tvSizeAvailable: true,
    fullSizeAvailable: true,
    videoAvailable: true,
    queueState: {
      currentIndex: 0,
      isShuffled: false,
      repeatMode: 'off',
      nowPlayingEntries: [
        { queueId: 1, item: { id: 1, title: 'Opening' } },
        { queueId: 2, item: { id: 2, title: 'Ending', album: 'ED', durationMs: 61_000 } },
      ],
    },
    registerVideoSurface: vi.fn(),
    seek: vi.fn(),
    toggleShuffle: vi.fn(),
    previous: vi.fn().mockResolvedValue(undefined),
    togglePlay: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    cycleRepeat: vi.fn(),
    setMode: vi.fn(),
    requestFullscreen: vi.fn().mockResolvedValue(undefined),
    skipTo: vi.fn(),
  }
})

describe('player views', () => {
  it('forwards every now-playing control including mode, fullscreen, seek, and queue selection', () => {
    render(<NowPlayingView className="wide" />)
    expect(screen.getByRole('tablist', { name: 'Player view' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Song' })).toHaveAttribute('aria-selected', 'false')
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '32' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enable shuffle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play current track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }))
    fireEvent.click(screen.getByRole('button', { name: 'TV size' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full size' }))
    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play Ending' }))

    expect(state.player.seek).toHaveBeenCalledWith(32)
    expect(state.player.toggleShuffle).toHaveBeenCalled()
    expect(state.player.previous).toHaveBeenCalled()
    expect(state.player.togglePlay).toHaveBeenCalled()
    expect(state.player.next).toHaveBeenCalled()
    expect(state.player.cycleRepeat).toHaveBeenCalled()
    expect(state.player.setMode.mock.calls.map((call: unknown[]) => call[0])).toEqual(['TV_SIZE', 'FULL_SIZE', 'VIDEO'])
    expect(state.player.requestFullscreen).toHaveBeenCalled()
    expect(state.player.skipTo).toHaveBeenCalledWith(1)
    expect(screen.getByRole('alert')).toHaveTextContent('Recoverable error')
    expect(screen.getByRole('status')).toHaveTextContent('Loading media')
  })

  it('forwards the compact player controls and opens the full view', () => {
    const onOpen = vi.fn()
    render(<MiniPlayerView onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play current track' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Seek mini player' }), { target: { value: '10' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '35' } })
    expect(onOpen).toHaveBeenCalled()
    expect(state.player.seek).toHaveBeenCalledWith(10)
    expect(screen.getByRole('button', { name: 'Enable shuffle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open queue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open fullscreen player' })).toBeInTheDocument()
  })

  it('replaces the artwork stage instead of stacking fallback art above video', () => {
    render(<NowPlayingView />)

    expect(screen.queryByText('AO')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Video surface')).toBeInTheDocument()
  })

  it('renders bounded empty states without enabling transport controls', () => {
    state.player.currentItem = undefined
    state.player.videoAvailable = false
    state.player.queueState.nowPlayingEntries = []
    const { rerender } = render(<MiniPlayerView />)
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    rerender(<NowPlayingView />)
    expect(screen.getByText('The queue is empty.')).toBeInTheDocument()
    expect(screen.getByText('Video unavailable for this theme.')).toBeInTheDocument()
  })

  it('disables TV size when the current queue item has no TV-sized media', () => {
    state.player.tvSizeAvailable = false
    state.player.mode = 'FULL_SIZE'

    render(<NowPlayingView />)

    expect(screen.getByRole('button', { name: 'TV size' })).toBeDisabled()
  })

  it('renders fallback metadata and paused-state controls without an open handler', () => {
    state.player.currentItem = { id: 3, title: 'No artwork' }
    state.player.isPlaying = true
    state.player.currentTime = Number.POSITIVE_INFINITY
    state.player.duration = -1
    state.player.mode = 'TV_SIZE'
    state.player.isLoading = false
    state.player.error = null
    render(<MiniPlayerView />)
    expect(screen.getByText('Anime Ongaku')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open now playing/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause current track' })).toBeInTheDocument()
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument()
  })
})
