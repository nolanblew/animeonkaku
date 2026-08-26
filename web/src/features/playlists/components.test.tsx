import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { PlaylistDto } from '../../lib/library'
import { PlaylistDetail, PlaylistList, PlaylistManager } from './components'

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

  it('supports accessible detail editing, reorder, remove, and delete confirmation', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<PlaylistDetail playlist={playlist()} onUpdate={onUpdate} onDelete={onDelete} />)
    expect(screen.getByRole('heading', { name: /night drive/i })).toBeInTheDocument()
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
})
