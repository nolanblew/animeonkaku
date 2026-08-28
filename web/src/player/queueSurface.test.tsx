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
  const result = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NowPlayingView />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))
  return result
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
      unskipEntry: vi.fn(),
    },
    isQueueEntryEligible: vi.fn((queueId: number) => queueId !== 14),
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
    expect(within(queue).getByRole('button', { name: 'More actions for History two in queue' })).toBeInTheDocument()
    expect(within(queue).getByRole('button', { name: 'More actions for Current theme in queue' })).toBeInTheDocument()

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Current theme in queue' }))
    expect(screen.getByRole('menuitem', { name: 'Go to Band' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Play next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add another to queue' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go to Band' }))

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for History two in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(screen.queryByRole('menu', { name: 'History two queue actions' })).not.toBeInTheDocument()

    expect(playerCss).toMatch(/player-queue__scroll[^}]*overflow-y:\s*auto/)
    expect(playerCss).not.toMatch(/player-queue li:nth-child/)
  })

  it('opens with the current item after at most three history rows while older history stays above the scroll window', () => {
    const historyEntries = Array.from({ length: 7 }, (_, index) => entry(30 + index, `History ${index + 1}`))
    const currentEntry = entry(37, 'Current theme')
    const upcomingEntry = entry(38, 'Upcoming one')
    const nowPlayingEntries = [...historyEntries, currentEntry, upcomingEntry]
    state.player = {
      ...state.player,
      currentItem: currentEntry.item,
      queueState: {
        ...state.player.queueState,
        currentIndex: historyEntries.length,
        historyEntries,
        nowPlayingEntries,
      },
    }

    renderPlayer()

    const queue = screen.getByRole('complementary', { name: 'Playback queue' })
    const historyRows = queue.querySelectorAll('li.player-queue__row--history')
    expect(historyRows).toHaveLength(3)
    expect(within(queue).getByText('History 5')).toBeInTheDocument()
    expect(within(queue).getByText('History 6')).toBeInTheDocument()
    expect(within(queue).getByText('History 7')).toBeInTheDocument()
    expect(within(queue).queryByText('History 1')).not.toBeInTheDocument()
    expect(within(queue).getByText('Current theme')).toBeInTheDocument()
    expect(within(queue).getByLabelText('Scrollable playback queue')).toHaveAttribute('tabindex', '0')

    fireEvent.wheel(within(queue).getByLabelText('Scrollable playback queue'), { deltaY: -30 })
    expect(within(queue).getByText('History 1')).toBeInTheDocument()
    expect(queue.querySelectorAll('li.player-queue__row--history')).toHaveLength(7)
  })

  it('uses stable queue-entry identity for replay, reorder, play-next, and removal', () => {
    renderPlayer()
    const queue = screen.getByRole('complementary', { name: 'Playback queue' })

    fireEvent.click(within(queue).getByRole('button', { name: 'Replay History two' }))
    expect(state.player.queue.rewindTo).toHaveBeenCalledWith(1)

    const dragHandle = within(queue).getByRole('button', { name: 'Drag Upcoming three to reorder' })
    const targetRow = within(queue).getByRole('button', { name: 'Play Upcoming two' }).closest('[data-queue-id]') as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => targetRow) })
    fireEvent.pointerDown(dragHandle, { pointerId: 11, pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(dragHandle, { pointerId: 11, pointerType: 'mouse', clientX: 10, clientY: 24 })
    fireEvent.pointerUp(dragHandle, { pointerId: 11, pointerType: 'mouse', clientX: 10, clientY: 24 })
    expect(state.player.queue.moveEntry).toHaveBeenCalledWith(15, 14)

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming four in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(state.player.queue.moveToPlayNext).toHaveBeenCalledWith(16)

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming four in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from queue' }))
    expect(state.player.queue.removeEntry).toHaveBeenCalledWith(16)
    expect(within(queue).queryByRole('button', { name: 'Remove Current theme from queue' })).not.toBeInTheDocument()
  })

  it('offers a per-occurrence unskip only for an upcoming disliked entry', () => {
    renderPlayer()
    const queue = screen.getByRole('complementary', { name: 'Playback queue' })

    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming two in queue' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Play this disliked item' }))

    expect(state.player.queue.unskipEntry).toHaveBeenCalledWith(14)
    fireEvent.click(within(queue).getByRole('button', { name: 'More actions for Upcoming one in queue' }))
    expect(screen.queryByRole('menuitem', { name: 'Play this disliked item' })).not.toBeInTheDocument()
  })
})
