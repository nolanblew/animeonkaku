import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyLibrary } from '../lib/library'
import { LIBRARY_QUERY_KEY, queryClient } from '../lib/query'

const playerState = vi.hoisted(() => ({ player: null as any }))
vi.mock('./PlayerProvider', () => ({ usePlayer: () => playerState.player }))

import { CurrentTrackActions } from './CurrentTrackActions'

describe('CurrentTrackActions preference subscription', () => {
  beforeEach(() => {
    playerState.player = {
      currentItem: { id: 44, itemType: 'THEME', themeId: 44, title: 'Opening Theme' },
      queue: { playNext: vi.fn(), addToQueue: vi.fn() },
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
})
