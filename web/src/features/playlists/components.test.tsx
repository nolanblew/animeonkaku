import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PlaylistDto } from '../../lib/library'
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

  it('navigates playlist cards to their detail route instead of selecting locally', async () => {
    render(<MemoryRouter initialEntries={['/playlists']}><QueryClientProvider client={new QueryClient()}><PlaylistManager playlists={[playlist()]} state="ready" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} /></QueryClientProvider><RouteProbe /></MemoryRouter>)

    await userEvent.click(screen.getByRole('link', { name: /night drive/i }))

    expect(screen.getByTestId('route')).toHaveTextContent('/playlist/2')
  })

  it('supports accessible detail editing, reorder, remove, and delete confirmation', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onPlay = vi.fn()
    renderWithQuery(<PlaylistDetail playlist={playlist()} onUpdate={onUpdate} onDelete={onDelete} onPlay={onPlay} />)
    expect(screen.getByRole('heading', { name: /night drive/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^play$/i }))
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), false)
    await userEvent.click(screen.getByRole('button', { name: /move .* up/i }))
    await userEvent.click(screen.getByRole('button', { name: /remove .* from playlist/i }))
    expect(onUpdate).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /delete playlist/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDelete).toHaveBeenCalledWith(2)
  })

  it('exposes create and advanced dynamic controls through the manager', async () => {
    renderWithQuery(<PlaylistManager playlists={[]} state="ready" onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /new playlist/i }))
    expect(screen.getByRole('dialog', { name: /create playlist/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/dynamic playlist/i)).toBeInTheDocument()
  })

  it('lets users switch to nested include/exclude logic, reorder sort keys, and choose snapshot mode', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistEditor onSubmit={onSubmit} />)
    await userEvent.type(screen.getByRole('textbox', { name: /playlist name/i }), 'Smart mix')
    await userEvent.click(screen.getByRole('checkbox', { name: /dynamic playlist/i }))
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
