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

function reorderableLibrary(): NormalizedLibrary {
  const library = displayLibrary()
  const firstTheme = library.themesById['10']!
  return {
    ...library,
    themesById: {
      ...library.themesById,
      '11': { ...firstTheme, id: 11, title: 'Real Ending', themeType: 'ED1' },
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

  it('wires playlist-card More actions to play, edit, and delete workflows', async () => {
    const onPlay = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistManager playlists={[playlist()]} state="ready" onCreate={vi.fn()} onUpdate={onUpdate} onDelete={onDelete} onPlay={onPlay} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    const menu = screen.getByRole('menu', { name: 'Night drive actions' })
    expect(menu.parentElement).toBe(document.body)
    expect(menu).toHaveClass('viewport-menu')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play playlist' }))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit playlist' }))
    expect(screen.getByRole('dialog', { name: 'Edit Night drive' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete playlist' }))
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 2 })))
  })

  it('renders playlist detail as a resolved music page without inline item editing', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onPlay = vi.fn()
    const onPlayItem = vi.fn()
    const onPlayNextItem = vi.fn()
    const onAddToQueueItem = vi.fn()
    const onPlayNext = vi.fn()
    const onAddToQueue = vi.fn()
    const onReplaceQueue = vi.fn()
    const onNavigateToArtist = vi.fn()
    const onNavigateToAnime = vi.fn()
    const onBack = vi.fn()
    renderWithQuery(<PlaylistDetail playlist={playlist()} library={displayLibrary()} onUpdate={onUpdate} onDelete={onDelete} onBack={onBack} onPlay={onPlay} onPlayItem={onPlayItem} onPlayNextItem={onPlayNextItem} onAddToQueueItem={onAddToQueueItem} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onReplaceQueue={onReplaceQueue} onNavigateToArtist={onNavigateToArtist} onNavigateToAnime={onNavigateToAnime} />)
    expect(screen.getByRole('heading', { name: /night drive/i })).toBeInTheDocument()
    expect(screen.getByTestId('playlist-artwork-2')).toHaveAttribute('data-layout', 'single')
    expect(screen.getByTestId('playlist-hero-backdrop')).toHaveStyle({ backgroundImage: 'url("/api/poster.jpg")' })
    expect(screen.getByText('Demo Anime · OP 1')).toBeInTheDocument()
    expect(screen.getByText('Real Opening · Demo Band')).toBeInTheDocument()
    expect(screen.queryByText('Theme #10')).not.toBeInTheDocument()
    expect(screen.queryByText(/^TV size$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove .* from playlist/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add track/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /catalog id/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^play all$/i }))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false)
    await userEvent.click(screen.getByRole('button', { name: /^shuffle$/i }))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), true)
    expect(screen.queryByRole('button', { name: /^play next$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^add to queue$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^replace queue$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete playlist/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    const playlistActions = screen.getByRole('menu', { name: 'Night drive actions' })
    expect(within(playlistActions).getByRole('menuitem', { name: 'Play next' })).toBeInTheDocument()
    expect(within(playlistActions).getByRole('menuitem', { name: 'Add to queue' })).toBeInTheDocument()
    expect(within(playlistActions).getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
    expect(within(playlistActions).getByRole('menuitem', { name: 'Add to playlist' })).toBeInTheDocument()
    expect(within(playlistActions).getByRole('menuitem', { name: 'Edit playlist' })).toBeInTheDocument()
    expect(within(playlistActions).getByRole('menuitem', { name: 'Delete playlist' })).toBeInTheDocument()
    await userEvent.click(within(playlistActions).getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNext).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))
    expect(onAddToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Replace queue' }))
    expect(onReplaceQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'Play Demo Anime · OP 1' }))
    expect(onPlayItem).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 0)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Demo Anime · OP 1' }))
    expect(screen.getByRole('menu', { name: 'Demo Anime · OP 1 actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save to playlist' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Go to Demo Band' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Go to Demo Anime' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Go to Demo Band' }))
    expect(onNavigateToArtist).toHaveBeenCalledWith('Demo Band')
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Demo Anime · OP 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Go to Demo Anime' }))
    expect(onNavigateToAnime).toHaveBeenCalledWith('anime-1')
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Demo Anime · OP 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNextItem).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 0)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Demo Anime · OP 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))
    expect(onAddToQueueItem).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), 0)
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Demo Anime · OP 1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from playlist' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({ items: [] })))
    await userEvent.click(screen.getByRole('button', { name: /all playlists/i }))
    expect(onBack).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit playlist' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete playlist' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /keep playlist/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete playlist' }))
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDelete).toHaveBeenCalledWith(2)
  })

  it('reorders manual playlist rows while preserving entry identity in the update', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const manual = playlist({
      entries: [10, 11],
      items: [
        { entryId: 44, itemType: 'THEME', itemId: 10, modeOverride: null },
        { entryId: 45, itemType: 'THEME', itemId: 11, modeOverride: 'FULL_SIZE' },
      ],
    })
    renderWithQuery(<PlaylistDetail playlist={manual} library={reorderableLibrary()} onUpdate={onUpdate} onDelete={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: /move Demo Anime · ED 1 up/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(2, expect.objectContaining({
      items: [
        { entryId: 45, itemType: 'THEME', itemId: 11, modeOverride: 'FULL_SIZE' },
        { entryId: 44, itemType: 'THEME', itemId: 10, modeOverride: null },
      ],
    })))
  })

  it('offers playlist-level play-next, append, and replace-queue actions', async () => {
    const onPlayNext = vi.fn()
    const onAddToQueue = vi.fn()
    const onReplaceQueue = vi.fn()
    const current = playlist({ entries: [10, 11], items: [
      { entryId: 44, itemType: 'THEME', itemId: 10, modeOverride: null },
      { entryId: 45, itemType: 'THEME', itemId: 11, modeOverride: null },
    ] })
    renderWithQuery(<PlaylistDetail playlist={current} library={reorderableLibrary()} onUpdate={vi.fn()} onDelete={vi.fn()} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onReplaceQueue={onReplaceQueue} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^play next$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^add to queue$/i }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /^replace queue$/i }))

    expect(onPlayNext).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(onAddToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(onReplaceQueue).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('exposes Refresh now only for a smart snapshot playlist', async () => {
    const onRefresh = vi.fn()
    const snapshot = playlist({
      isDynamic: true,
      autoUpdate: false,
      dynamicSpecJson: { mode: 'SNAPSHOT', filterJson: { type: 'liked' } },
    })
    renderWithQuery(<PlaylistDetail playlist={snapshot} library={displayLibrary()} onUpdate={vi.fn()} onDelete={vi.fn()} onRefresh={onRefresh} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Night drive' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh now' }))

    expect(onRefresh).toHaveBeenCalledWith(expect.objectContaining({ id: 2, isDynamic: true }))
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
