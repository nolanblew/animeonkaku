import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => state.player }))

import { NowPlayingView } from './NowPlayingView'
import playerCss from './player.css?raw'

function entry(queueId: number, title: string) {
  return { queueId, item: { id: queueId, title, artist: 'Band', durationMs: 90_000 } }
}

function renderPlayer() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NowPlayingView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  const entries = [
    entry(10, 'History one'),
    entry(11, 'History two'),
    entry(12, 'Current theme'),
    entry(13, 'Upcoming one'),
    entry(14, 'Upcoming two'),
    entry(15, 'Upcoming three'),
    entry(16, 'Upcoming four'),
    entry(17, 'Upcoming five'),
  ]
  state.player = {
    currentItem: entries[2].item,
    currentTime: 15,
    duration: 90,
    mode: 'TV_SIZE',
    isPlaying: false,
    isLoading: false,
    error: null,
    tvSizeAvailable: true,
    fullSizeAvailable: false,
    videoAvailable: false,
    queueState: {
      currentIndex: 2,
      isShuffled: false,
      repeatMode: 'off',
      historyEntries: entries.slice(0, 2),
      nowPlayingEntries: entries,
    },
    registerVideoSurface: vi.fn(),
    seek: vi.fn(),
    toggleShuffle: vi.fn(),
    previous: vi.fn(),
    togglePlay: vi.fn(),
    next: vi.fn(),
    cycleRepeat: vi.fn(),
    setMode: vi.fn(),
    requestFullscreen: vi.fn(),
    skipTo: vi.fn(),
    queue: {
      playNext: vi.fn(),
      addToQueue: vi.fn(),
      rewindTo: vi.fn(),
      moveEntry: vi.fn(),
      moveToPlayNext: vi.fn(),
      removeEntry: vi.fn(),
    },
  }
})

describe('accessible full-player queue surface', () => {
  it('exposes history, current, and every upcoming occurrence without CSS clipping', () => {
    renderPlayer()

    const queue = screen.getByRole('complementary', { name: 'Playback queue' })
    expect(within(queue).getByRole('heading', { name: 'History' })).toBeInTheDocument()
    expect(within(queue).getByRole('heading', { name: 'Now playing' })).toBeInTheDocument()
    expect(within(queue).getByRole('heading', { name: 'Up next' })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Replay History one' })).toBeInTheDocument()
    expect(within(queue).getByText('Current theme')).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'Play Upcoming five' })).toBeInTheDocument()

    expect(playerCss).toMatch(/player-queue__scroll[^}]*overflow-y:\s*auto/)
    expect(playerCss).not.toMatch(/player-queue li:nth-child/)
  })

  it('uses stable queue-entry identity for replay, reorder, play-next, and removal', () => {
    renderPlayer()
    const queue = screen.getByRole('complementary', { name: 'Playback queue' })

    fireEvent.click(within(queue).getByRole('button', { name: 'Replay History two' }))
    expect(state.player.queue.rewindTo).toHaveBeenCalledWith(1)

    fireEvent.click(within(queue).getByRole('button', { name: 'Move Upcoming three up' }))
    expect(state.player.queue.moveEntry).toHaveBeenCalledWith(15, 14)

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming four in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(state.player.queue.moveToPlayNext).toHaveBeenCalledWith(16)

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming four in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from queue' }))
    expect(state.player.queue.removeEntry).toHaveBeenCalledWith(16)
    expect(within(queue).queryByRole('button', { name: 'Remove Current theme from queue' })).not.toBeInTheDocument()
  })
})
