import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  refreshPlaylistSnapshot,
  updatePlaylist,
  updatePlaylistSpec,
} from './api'

describe('playlist API adapter', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('uses the existing playlist endpoints and supports delta cursors', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([])
    await listPlaylists(123)
    expect(get).toHaveBeenCalledWith('/v1/playlists?since=123')
    await listPlaylists(null)
    expect(get).toHaveBeenLastCalledWith('/v1/playlists')
  })

  it('sends create and item updates as JSON while preserving entry ids', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ playlist: { id: 2 } })
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ playlist: { id: 2 } })
    await createPlaylist({ name: 'Mix', items: [{ entryId: 9, itemType: 'THEME', itemId: 4, modeOverride: null }] })
    expect(post).toHaveBeenCalledWith('/v1/playlists', expect.objectContaining({ name: 'Mix' }))
    await updatePlaylist(2, { items: [{ entryId: 9, itemType: 'THEME', itemId: 4, modeOverride: 'FULL_SIZE' }] })
    expect(request).toHaveBeenCalledWith('/v1/playlists/2', expect.objectContaining({ method: 'PUT' }))
    await updatePlaylistSpec(2, { filterJson: { type: 'liked' } })
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/2/spec', expect.objectContaining({ method: 'PUT' }))
    await refreshPlaylistSnapshot(2)
    expect(request).toHaveBeenLastCalledWith('/v1/playlists/2/refresh', expect.objectContaining({ method: 'POST' }))
  })

  it('uses DELETE and rejects non-positive ids before making a request', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(undefined)
    await deletePlaylist(7)
    expect(request).toHaveBeenCalledWith('/v1/playlists/7', expect.objectContaining({ method: 'DELETE' }))
    await expect(deletePlaylist(0)).rejects.toThrow('Playlist id must be positive.')
  })
})
