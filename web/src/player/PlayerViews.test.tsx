import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => state.player }))

import { MiniPlayerView } from './MiniPlayerView'
import { NowPlayingView } from './NowPlayingView'

function renderPlayer(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  state.player = {
    currentItem: { id: 1, itemType: 'THEME', themeId: 1, title: 'Opening', artist: 'Band', animeTitle: 'A Couple of Cuckoos', themeType: 'ED2', animeId: 'anime-1', artworkUrl: '/art.jpg', audioUrl: '/audio.mp3', videoUrl: '/video.mp4', durationMs: 90_000 },
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
        { queueId: 1, item: { id: 1, itemType: 'THEME', title: 'Opening', artist: 'Band', animeTitle: 'A Couple of Cuckoos', themeType: 'ED2' } },
        { queueId: 2, item: { id: 2, title: 'Ending', album: 'ED', durationMs: 61_000 } },
        { queueId: 3, item: { id: 3, title: 'A very long queue title that should remain readable across the row', artist: 'Long-name artist' } },
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
    playItems: vi.fn(),
    queue: { playNext: vi.fn(), addToQueue: vi.fn(), moveEntry: vi.fn(), rewindTo: vi.fn(), moveToPlayNext: vi.fn(), removeEntry: vi.fn(), unskipEntry: vi.fn() },
    isQueueEntryEligible: vi.fn(() => true),
  }
})

describe('player views', () => {
  it('forwards every now-playing control including mode, fullscreen, seek, and queue selection', () => {
    renderPlayer(<NowPlayingView className="wide" />)
    expect(screen.getByRole('tablist', { name: 'Playback type' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Video' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'TV size' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Full size' })).toHaveAttribute('aria-selected', 'false')
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
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))
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

  it('shows the active playback type below the artist and centers actions after transport', () => {
    state.player.mode = 'FULL_SIZE'
    const { container } = renderPlayer(<NowPlayingView />)

    expect(screen.getByText('Full size', { selector: '.player-now-playing__type-label' })).toBeInTheDocument()
    expect(container.querySelector('.player-mode-controls')).not.toBeInTheDocument()
    const details = container.querySelector('.player-now-playing__details')
    const controls = container.querySelector('.player-now-playing__controls')
    const actions = container.querySelector('.player-now-playing__secondary-actions')
    expect(controls?.compareDocumentPosition(actions as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('matches mobile title hierarchy in the mini player, full player, and queue', () => {
    const mini = renderPlayer(<MiniPlayerView />)
    expect(screen.getByText('A Couple of Cuckoos · ED 2')).toBeInTheDocument()
    expect(screen.getByText('Opening · Band')).toBeInTheDocument()
    mini.unmount()

    renderPlayer(<NowPlayingView />)
    expect(screen.getByRole('heading', { name: 'A Couple of Cuckoos · ED 2' })).toBeInTheDocument()
    expect(screen.getByText('Opening · Band')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))
    expect(screen.getByText('A Couple of Cuckoos · ED 2', { selector: '.player-queue__title' })).toBeInTheDocument()
  })

  it('keeps the queue hidden until requested and removes redundant row timing and section counts', () => {
    renderPlayer(<NowPlayingView />)

    expect(screen.queryByRole('complementary', { name: 'Playback queue' })).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show queue' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    const queue = screen.getByRole('complementary', { name: 'Playback queue' })
    expect(screen.getByRole('button', { name: 'Hide queue' })).toHaveAttribute('aria-expanded', 'true')
    expect(queue.querySelector('time')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Now playing' }).parentElement).toHaveTextContent(/^Now playing$/)
    expect(screen.getByRole('heading', { name: 'Up next' }).parentElement).toHaveTextContent(/^Up next$/)
    expect(screen.getByText('3 items')).toBeInTheDocument()
    expect(screen.getByText('A very long queue title that should remain readable across the row')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close queue' }))
    expect(screen.queryByRole('complementary', { name: 'Playback queue' })).not.toBeInTheDocument()
  })

  it('reorders up-next entries only from the dedicated drag handle', () => {
    renderPlayer(<NowPlayingView />)
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))

    const handle = screen.getByRole('button', { name: 'Drag A very long queue title that should remain readable across the row to reorder' })
    const endingRow = screen.getByText('Ending').closest('[data-queue-id]') as HTMLElement
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => endingRow) })

    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 24 })
    fireEvent.pointerUp(handle, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 24 })

    expect(state.player.queue.moveEntry).toHaveBeenCalledWith(3, 2)
  })

  it('treats an immediate vertical touch move as scrolling instead of reordering', () => {
    renderPlayer(<NowPlayingView />)
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))
    const handle = screen.getByRole('button', { name: 'Drag Ending to reorder' })

    fireEvent.pointerDown(handle, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 30 })
    fireEvent.pointerUp(handle, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 30 })

    expect(state.player.queue.moveEntry).not.toHaveBeenCalled()
  })

  it('uses thumb preferences and omits duplicate queue actions from the active track', () => {
    renderPlayer(<NowPlayingView />)
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dislike' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unlike track|like track/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening' }))
    expect(screen.queryByRole('menuitem', { name: 'Play next' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Add to queue' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
  })

  it('exposes the complete context-aware track menu from both full and mini players', () => {
    const expectSharedActions = () => {
      fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening' }))
      expect(screen.getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Play Video' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Go to artist' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Go to anime' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Related Music' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Prefer Full Size' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Replace queue' }))
      expect(state.player.playItems).toHaveBeenCalledWith([state.player.currentItem], { contextLabel: 'Now playing', startIndex: 0, shuffle: false })
    }

    const full = renderPlayer(<NowPlayingView />)
    expectSharedActions()
    full.unmount()

    renderPlayer(<MiniPlayerView />)
    expectSharedActions()
  })

  it('forwards the compact player controls and opens the full view', () => {
    const onOpen = vi.fn()
    renderPlayer(<MiniPlayerView onOpen={onOpen} />)
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
    expect(document.querySelector('.player-mini-player__track img')).toHaveClass('player-shared-artwork')
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Opening' }))
    expect(screen.getByRole('menu', { name: 'Opening actions' })).toBeInTheDocument()
  })

  it('replaces the artwork stage instead of stacking fallback art above video', () => {
    renderPlayer(<NowPlayingView />)

    expect(screen.queryByText('AO')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Video surface')).toBeInTheDocument()
  })

  it('uses a real progress rail, shared artwork transition, and collapses the expanded player', () => {
    const onCollapse = vi.fn()
    state.player.mode = 'TV_SIZE'
    state.player.isLoading = false
    state.player.error = null
    renderPlayer(<NowPlayingView onCollapse={onCollapse} />)

    expect(document.querySelector('.player-waveform')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument()
    expect(document.querySelector('.player-now-playing__artwork-wrap')).toHaveClass('player-shared-artwork')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse player' }))
    expect(onCollapse).toHaveBeenCalled()
  })

  it('renders bounded empty states without enabling transport controls', () => {
    state.player.currentItem = undefined
    state.player.videoAvailable = false
    state.player.queueState.nowPlayingEntries = []
    const queryClient = new QueryClient()
    const { rerender } = render(<QueryClientProvider client={queryClient}><MiniPlayerView /></QueryClientProvider>)
    expect(screen.getByText('Nothing playing')).toBeInTheDocument()
    rerender(<QueryClientProvider client={queryClient}><NowPlayingView /></QueryClientProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Show queue' }))
    expect(screen.getByText('The queue is empty.')).toBeInTheDocument()
    expect(screen.getByText('Video unavailable for this theme.')).toBeInTheDocument()
  })

  it('disables TV size when the current queue item has no TV-sized media', () => {
    state.player.tvSizeAvailable = false
    state.player.mode = 'FULL_SIZE'

    renderPlayer(<NowPlayingView />)

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
    renderPlayer(<MiniPlayerView />)
    expect(screen.getByText('Anime Ongaku')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open now playing/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pause current track' })).toBeInTheDocument()
    expect(screen.getByText('0:00 / 0:00')).toBeInTheDocument()
  })
})
