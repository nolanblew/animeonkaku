import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoSafetyDialog } from './VideoSafetyDialog'

const state = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => state.player }))

import { NowPlayingView } from './NowPlayingView'

function renderPlayer() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NowPlayingView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  state.player = {
    currentItem: { id: 1, itemType: 'THEME', themeId: 1, title: 'Opening', artist: 'Band', durationMs: 90_000 },
    currentTime: 0,
    duration: 90,
    mode: 'TV_SIZE',
    isPlaying: false,
    isLoading: false,
    error: null,
    tvSizeAvailable: true,
    fullSizeAvailable: false,
    videoAvailable: false,
    queueState: {
      currentIndex: 0,
      isShuffled: false,
      repeatMode: 'off',
      historyEntries: [],
      nowPlayingEntries: [
        { queueId: 1, item: { id: 1, title: 'Opening', durationMs: 90_000 } },
        { queueId: 2, item: { id: 2, title: 'Ending', durationMs: 60_000 } },
      ],
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
    isQueueEntryEligible: vi.fn(() => true),
  }
})

describe('full-player queue menu keyboard behavior', () => {
  it('moves focus into queue actions and restores it to the row trigger on close', async () => {
    const user = userEvent.setup()
    renderPlayer()

    const trigger = screen.getByRole('button', { name: 'More actions for Ending in queue' })
    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Ending queue actions' })
    const playNext = screen.getByRole('menuitem', { name: 'Play next' })

    expect(playNext).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Ending queue actions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(menu).not.toBeInTheDocument()
  })

  it('wraps Tab within the queue menu and returns focus after its explicit Close action', async () => {
    const user = userEvent.setup()
    renderPlayer()

    const trigger = screen.getByRole('button', { name: 'More actions for Ending in queue' })
    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Ending queue actions' })
    const actions = withinMenuButtons(menu)
    const first = actions[0]
    const last = actions[actions.length - 1]

    expect(first).toHaveFocus()
    last?.focus()
    await user.tab()
    expect(first).toHaveFocus()

    await user.click(screen.getByRole('menuitem', { name: 'Close' }))
    expect(screen.queryByRole('menu', { name: 'Ending queue actions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('dismisses the queue menu on an outside pointer without losing trigger focus', async () => {
    const user = userEvent.setup()
    renderPlayer()

    const trigger = screen.getByRole('button', { name: 'More actions for Ending in queue' })
    await user.click(trigger)
    expect(screen.getByRole('menu', { name: 'Ending queue actions' })).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('menu', { name: 'Ending queue actions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

function withinMenuButtons(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('button'))
}

describe('video warning dialog keyboard behavior', () => {
  it('closes on Escape, traps focus, and restores focus to its opener', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open video warning</button>
          {open && (
            <VideoSafetyDialog
              title="Opening"
              spoiler
              nsfw
              onCancel={() => setOpen(false)}
              onContinue={() => setOpen(false)}
            />
          )}
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open video warning' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Video content warning' })
    const continueButton = screen.getByRole('button', { name: 'Continue to video' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel video' })

    expect(continueButton).toHaveFocus()
    continueButton.focus()
    await user.tab()
    expect(cancelButton).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Video content warning' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(dialog).not.toBeInTheDocument()
  })
})
