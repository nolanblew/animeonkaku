import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { createEmptyLibrary, type NormalizedLibrary, type PlaylistDto } from '../../lib/library'
import { PlaylistDetail, PlaylistEditor, PlaylistList, PlaylistManager } from './components'

const playlist = (overrides: Partial<PlaylistDto> = {}): PlaylistDto => ({
  id: 2,
  name: 'Night drive',
  entries: [10],
  defaultMode: 'TV_SIZE',
  overrideUserPreference: false,
  items: [{ entryId: 44, itemType: 'THEME', itemId: 10, modeOverride: null }],
  isAuto: false,
  isDynamic: false,
  autoUpdate: false,
  updatedAt: 10,
  deleted: false,
  dynamicSpecJson: null,
  dynamicSortJson: null,
  ...overrides,
})

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MemoryRouter><QueryClientProvider client={queryClient}>{ui}</QueryClientProvider></MemoryRouter>)
}

function RouteProbe() {
  return <output data-testid="route">{useLocation().pathname}</output>
}

function displayLibrary(): NormalizedLibrary {
  return {
    ...createEmptyLibrary(),
    animeById: {
      'anime-1': {
        kitsuId: 'anime-1', animeThemesId: 1, title: 'Demo Anime', titleEn: null, titleRomaji: null, titleJa: null,
        posterUrl: '/poster.jpg', coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null,
        endDate: null, episodeCount: 12, ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1,
        slug: 'demo-anime', genres: [], updatedAt: 1, deleted: false,
      },
    },
    themesById: {
      '10': {
        id: 10, animeThemesAnimeId: 1, kitsuAnimeIds: ['anime-1'], title: 'Real Opening', themeType: 'OP1',
        artists: [{ name: 'Demo Band', asCharacter: null, alias: null }], audioUrl: '/audio/10', videoUrl: null,
        audioState: 'READY', durationSeconds: 90, fileSize: null,
        mediaModes: { tvSize: { url: '/audio/10', durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
        updatedAt: 1, deleted: false,
      },
    },
  }
}

describe('playlist components', () => {
  it('renders list loading, empty, and error states with accessible labels', () => {
    const onCreate = vi.fn()
    const { rerender } = renderWithQuery(<PlaylistList state="loading" playlists={[]} onCreate={onCreate} />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading playlists/i)
    rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><PlaylistList state="empty" playlists={[]} onCreate={onCreate} /></QueryClientProvider></MemoryRouter>)
    expect(screen.getByText(/no playlists yet/i)).toBeInTheDocument()
    rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}><PlaylistList state="error" playlists={[]} error="Could not load" onCreate={onCreate} /></QueryClientProvider></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
  })

  it('filters large lists through a bounded result window', async () => {
    const playlists = Array.from({ length: 1500 }, (_, id) => playlist({ id: id + 1, name: `Mix ${id + 1}` }))
    renderWithQuery(<PlaylistList state="ready" playlists={playlists} onCreate={vi.fn()} maxVisible={50} />)
    const search = screen.getByRole('searchbox', { name: /filter playlists/i })
    await userEvent.type(search, 'Mix 1')
    expect(screen.getAllByRole('link')).toHaveLength(50)
    expect(screen.getByText(/showing 50 of/i)).toBeInTheDocument()
  })

  it('loads additional playlist pages without rendering the whole collection', async () => {
    const playlists = Array.from({ length: 250 }, (_, id) => playlist({ id: id + 1, name: `Mix ${id + 1}` }))
    renderWithQuery(<PlaylistList state="ready" playlists={playlists} onCreate={vi.fn()} maxVisible={50} />)

    expect(screen.getAllByRole('link')).toHaveLength(50)
    await userEvent.click(screen.getByRole('button', { name: /load more playlists/i }))
    expect(screen.getAllByRole('link')).toHaveLength(100)
    expect(screen.getByText(/showing 100 of 250/i)).toBeInTheDocument()
  })

  it('navigates playlist cards to their detail route instead of selecting locally', async () => {
    render(<MemoryRouter initialEntries={['/playlists']}><QueryClientProvider client={new QueryClient()}><PlaylistManager playlists={[playlist()]} state="ready" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} /></QueryClientProvider><RouteProbe /></MemoryRouter>)

    await userEvent.click(screen.getByRole('link', { name: /night drive/i }))

    expect(screen.getByTestId('route')).toHaveTextContent('/playlist/2')
  })

  it('renders playlist detail as a resolved music page without inline item editing', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onPlay = vi.fn()
    const onPlayItem = vi.fn()
    renderWithQuery(<PlaylistDetail playlist={playlist()} library={displayLibrary()} onUpdate={onUpdate} onDelete={onDelete} onPlay={onPlay} onPlayItem={onPlayItem} />)
    expect(screen.getByRole('heading', { name: /night drive/i })).toBeInTheDocument()
    expect(screen.getByTestId('playlist-artwork-2')).toHaveAttribute('data-layout', 'single')
    expect(screen.getByTestId('playlist-hero-backdrop')).toHaveStyle({ backgroundImage: 'url("/api/poster.jpg")' })
    expect(screen.getByText('Real Opening')).toBeInTheDocument()
    expect(screen.getByText(/Demo Anime · OP1 · Demo Band/)).toBeInTheDocument()
    expect(screen.queryByText('Theme #10')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /move .* up/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove .* from playlist/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add track/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /catalog id/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false)
    await userEvent.click(screen.getByRole('button', { name: 'Play Real Opening' }))
    expect(onPlayItem).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 0)
    await userEvent.click(screen.getByRole('button', { name: /delete playlist/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDelete).toHaveBeenCalledWith(2)
  })

  it('renders missing catalog items without exposing raw database ids', () => {
    renderWithQuery(<PlaylistDetail playlist={playlist({ items: [{ entryId: 44, itemType: 'THEME', itemId: 999, modeOverride: null }] })} library={displayLibrary()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Unavailable track')).toBeInTheDocument()
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument()
    expect(screen.queryByText(/999/)).not.toBeInTheDocument()
  })

  it('starts playlist creation with an approachable manual-or-smart choice', async () => {
    renderWithQuery(<PlaylistManager playlists={[]} state="ready" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /new playlist/i }))
    expect(screen.getByRole('dialog', { name: /create playlist/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /what kind of playlist/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /manual playlist/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /smart playlist/i }))
    const steps = screen.getByRole('navigation', { name: /smart playlist steps/i })
    expect(steps).toHaveTextContent('Details')
    expect(steps).toHaveTextContent('Rules')
    expect(steps).toHaveTextContent('Review')
    expect(screen.getByRole('textbox', { name: /playlist name/i })).toBeInTheDocument()
  })

  it('opens the creation flow from the sidebar deep link', () => {
    renderWithQuery(<PlaylistManager playlists={[]} state="ready" initialCreate onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /create playlist/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /what kind of playlist/i })).toBeInTheDocument()
  })

  it('keeps manual playlist creation short and focused', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistEditor onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /manual playlist/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /playlist name/i }), 'Favorites')
    await userEvent.click(screen.getByRole('button', { name: /create playlist/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Favorites', dynamicSpecJson: null }))
  })

  it('lets users switch to nested include/exclude logic, reorder sort keys, and choose snapshot mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistEditor onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: /smart playlist/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /playlist name/i }), 'Smart mix')
    await userEvent.click(screen.getByRole('button', { name: /continue to rules/i }))
    await userEvent.click(screen.getByRole('button', { name: /move sort key 2 up/i }))
    await userEvent.click(screen.getByRole('radio', { name: /advanced logic/i }))
    expect(screen.getByRole('heading', { name: /include rules/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /exclude rules/i })).toBeInTheDocument()
    const exclude = screen.getByRole('heading', { name: /exclude rules/i }).closest('section')
    expect(exclude).not.toBeNull()
    await userEvent.click(within(exclude as HTMLElement).getByRole('button', { name: /add rule/i }))
    expect(screen.getByText(/excluded/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add group/i }))
    expect(screen.getByText(/or group/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /snapshot these tracks/i }))
    expect(screen.getByText(/current tracks are kept as a fixed snapshot/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /review playlist/i }))
    expect(screen.getByRole('heading', { name: /review & create/i })).toBeInTheDocument()
    expect(screen.getByText(/expert json \(recovery\)/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /create playlist/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      dynamicSortJson: { keys: [{ attribute: 'TITLE', direction: 'ASC' }, { attribute: 'WATCHED_DATE', direction: 'DESC' }] },
      autoUpdate: false,
    }))
  })

  it('loads an existing mobile/server envelope into structured controls and saves a compatible payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistEditor playlist={playlist({
      isDynamic: true,
      autoUpdate: true,
      dynamicSpecJson: {
        filterJson: { type: 'and', children: [{ type: 'not', child: { type: 'liked' } }] },
        mode: 'AUTO',
        createdMode: 'ADVANCED',
        schemaVersion: 1,
        simpleStateJson: null,
      },
      dynamicSortJson: { keys: [{ attribute: 'TITLE', direction: 'ASC' }] },
    })} onSubmit={onSubmit} />)
    expect(screen.getByRole('radio', { name: /advanced logic/i })).toBeChecked()
    expect(screen.getByText(/not \/ excluded/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      dynamicSpecJson: expect.objectContaining({ mode: 'AUTO', createdMode: 'ADVANCED', schemaVersion: 1 }),
      dynamicSortJson: { keys: [{ attribute: 'TITLE', direction: 'ASC' }] },
      autoUpdate: true,
    }))
  })
})
