import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyLibrary, type LibraryThemeDto, type NormalizedLibrary, type PlaylistDto } from '../../lib/library'
import { PlaylistDetail } from './components'

function theme(index: number): LibraryThemeDto {
  return {
    id: 50_000 + index,
    animeThemesAnimeId: 1,
    kitsuAnimeIds: [],
    title: `Long mix track ${index}`,
    themeType: 'OP1',
    artists: [],
    audioUrl: `/api/v1/media/audio/${50_000 + index}`,
    videoUrl: null,
    audioState: 'READY',
    durationSeconds: 120,
    fileSize: null,
    mediaModes: {
      tvSize: { url: `/api/v1/media/audio/${50_000 + index}`, durationSeconds: 120, fileSize: null },
      fullSize: null,
      video: null,
    },
    updatedAt: 1,
    deleted: false,
  }
}

function largeLibrary(count: number): NormalizedLibrary {
  const themes = Array.from({ length: count }, (_, index) => theme(index))
  return {
    ...createEmptyLibrary(),
    themesById: Object.fromEntries(themes.map((item) => [String(item.id), item])),
  }
}

function largePlaylist(count: number): PlaylistDto {
  const items = Array.from({ length: count }, (_, index) => ({
    entryId: 10_000 + index,
    itemType: 'THEME' as const,
    itemId: 50_000 + index,
    modeOverride: null,
  }))
  return {
    id: 77,
    name: 'Long mix',
    entries: items.map((item) => item.itemId),
    defaultMode: 'TV_SIZE',
    overrideUserPreference: false,
    items,
    isAuto: false,
    isDynamic: false,
    autoUpdate: false,
    updatedAt: 1,
    deleted: false,
    dynamicSpecJson: null,
    dynamicSortJson: null,
  }
}

function renderDetail(playlist: PlaylistDto, library: NormalizedLibrary) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PlaylistDetail playlist={playlist} library={library} onUpdate={vi.fn()} onDelete={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('large playlist rendering contract', () => {
  it('keeps a 1,200-track playlist bounded while retaining an accessible way to reveal the full sequence', async () => {
    renderDetail(largePlaylist(1_200), largeLibrary(1_200))

    const list = document.querySelector('ol.playlist-track-list')
    expect(list).not.toBeNull()
    const initialRows = within(list as HTMLElement).getAllByRole('listitem')
    expect(initialRows.length).toBeLessThanOrEqual(60)
    expect(initialRows.length).toBeGreaterThan(0)
    expect(list).toHaveAttribute('aria-setsize', '1200')
    expect(screen.getByText(/showing \d+ of 1200 tracks/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /load more playlist tracks/i }))
    expect(within(list as HTMLElement).getByRole('button', { name: 'Play Long mix track 60' })).toBeInTheDocument()
    expect(within(list as HTMLElement).getAllByRole('listitem').length).toBeLessThanOrEqual(120)
  })
})
