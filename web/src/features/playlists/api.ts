import { apiClient, type JsonValue } from '../../lib/api'
import type { PlaylistDto } from '../../lib/library'
import type { PlaylistUpdateInput, PlaylistItemInput } from './model'

export interface PlaylistCreateInput extends Partial<Omit<PlaylistUpdateInput, 'name'>> {
  name: string
}

type PlaylistResponse = { playlist: PlaylistDto }

export function listPlaylists(since: number | null = null): Promise<PlaylistDto[]> {
  const path = since === null ? '/v1/playlists' : `/v1/playlists?since=${encodeURIComponent(String(since))}`
  return apiClient.get<PlaylistDto[] | { playlists: PlaylistDto[] }>(path).then((response) => Array.isArray(response) ? response : response.playlists)
}

export function createPlaylist(input: PlaylistCreateInput): Promise<PlaylistDto> {
  return apiClient.post<PlaylistResponse>('/v1/playlists', input as unknown as JsonValue).then((response) => response.playlist)
}

export function updatePlaylist(id: number, input: Partial<PlaylistUpdateInput> & { items?: PlaylistItemInput[] }): Promise<PlaylistDto> {
  assertPlaylistId(id)
  return apiClient.request<PlaylistResponse>(`/v1/playlists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((response) => response.playlist)
}

export function updatePlaylistSpec(id: number, spec: unknown): Promise<PlaylistDto> {
  assertPlaylistId(id)
  return apiClient.request<PlaylistResponse>(`/v1/playlists/${id}/spec`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  }).then((response) => response.playlist)
}

export async function deletePlaylist(id: number): Promise<void> {
  assertPlaylistId(id)
  await apiClient.request<void>(`/v1/playlists/${id}`, { method: 'DELETE' })
}

function assertPlaylistId(id: number): asserts id is number {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Playlist id must be positive.')
}
