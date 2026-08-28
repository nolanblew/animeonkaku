import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionActionMenu } from './CollectionActionMenu'
import { listManualPlaylists } from './api'

const addItemsToPlaylist = vi.fn()
const createPlaylistWithItems = vi.fn()

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listManualPlaylists: vi.fn(),
}))

vi.mock('./hooks', () => ({
  useLibraryActions: () => ({
    addItemsToPlaylist,
    createPlaylistWithItems,
    pendingAction: null,
    actionError: null,
  }),
}))

beforeEach(() => {
  addItemsToPlaylist.mockReset().mockResolvedValue(undefined)
  createPlaylistWithItems.mockReset().mockResolvedValue(undefined)
  vi.mocked(listManualPlaylists).mockReset().mockResolvedValue([])
})

describe('CollectionActionMenu', () => {
  it('runs every supplied collection action and closes after each selection', async () => {
    const callbacks = {
      onPlayNext: vi.fn(), onAddToQueue: vi.fn(), onReplaceQueue: vi.fn(),
      onRefresh: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(),
    }
    render(<CollectionActionMenu name="Mix" refreshLabel="Update mix" {...callbacks} />)

    for (const [label, callback] of [
      ['Play next', callbacks.onPlayNext], ['Add to queue', callbacks.onAddToQueue],
      ['Replace queue', callbacks.onReplaceQueue], ['Update mix', callbacks.onRefresh],
      ['Edit playlist', callbacks.onEdit], ['Delete playlist', callbacks.onDelete],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Mix' }))
      await userEvent.click(screen.getByRole('menuitem', { name: label }))
      expect(callback).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('menu', { name: 'Mix actions' })).not.toBeInTheDocument()
    }
  })

  it('adds all items to an existing playlist or a newly created playlist', async () => {
    const items = [{ itemType: 'THEME' as const, itemId: 7, modeOverride: null }]
    vi.mocked(listManualPlaylists).mockResolvedValue([{
      id: 3, name: 'Road trip', isAuto: false, isDynamic: false, autoUpdate: false,
      defaultMode: 'TV_SIZE', overrideUserPreference: false, dynamicSpecJson: null,
      dynamicSortJson: null, entries: [], items: [], updatedAt: 1, deleted: false,
    }])
    render(<CollectionActionMenu name="Anime themes" items={items} />)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Anime themes' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist' }))
    const picker = await screen.findByRole('dialog', { name: 'Add to playlist' })
    await userEvent.click(within(picker).getByRole('button', { name: /Road trip/i }))
    expect(addItemsToPlaylist).toHaveBeenCalledWith(3, items)

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Anime themes' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to playlist' }))
    const secondPicker = await screen.findByRole('dialog', { name: 'Add to playlist' })
    await userEvent.type(within(secondPicker).getByLabelText('New playlist name'), 'Favorites')
    await userEvent.click(within(secondPicker).getByRole('button', { name: 'Create playlist' }))
    expect(createPlaylistWithItems).toHaveBeenCalledWith('Favorites', items)
  })
})
