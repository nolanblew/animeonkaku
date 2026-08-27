import { apiClient, type JsonValue } from '../../lib/api'
import type { PlaylistDto, PlaylistPlaybackMode, SongPrefDto, ThemePrefDto } from '../../lib/library'

export interface ThemePreferencePatch {
  liked?: boolean
  disliked?: boolean
  dislikedTvSize?: boolean
  dislikedFullSize?: boolean
  preferredMode?: PlaylistPlaybackMode | null
}

export interface SongPreferencePatch {
  liked?: boolean
  disliked?: boolean
}

export interface PlaylistItemInput {
  entryId?: number
  itemType: 'THEME' | 'SONG'
  itemId: number
  modeOverride: PlaylistPlaybackMode | null
}

export interface PlaylistCreateInput {
  name: string
  items: PlaylistItemInput[]
  defaultMode: PlaylistPlaybackMode
  overrideUserPreference: boolean
  autoUpdate: boolean
}

export function updateThemePreference(themeId: number, patch: ThemePreferencePatch): Promise<ThemePrefDto> {
  assertPositiveId(themeId, 'Theme id')
  return apiClient.request<ThemePrefDto>(`/v1/prefs/themes/${themeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function updateSongPreference(songId: number, patch: SongPreferencePatch): Promise<SongPrefDto> {
  assertPositiveId(songId, 'Song id')
  return apiClient.request<SongPrefDto>(`/v1/prefs/songs/${songId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function addAnimeToLibrary(input: { kitsuId?: string; animeThemesId?: number }): Promise<{ accepted: boolean; queuedJobIds: number[] }> {
  if (!input.kitsuId && (!input.animeThemesId || input.animeThemesId <= 0)) throw new Error('An anime identifier is required.')
  return apiClient.post<{ accepted: boolean; queuedJobIds: number[] }>('/v1/library/anime', input as unknown as JsonValue)
}

export async function removeAnimeFromLibrary(kitsuId: string): Promise<void> {
  if (!kitsuId.trim()) throw new Error('Anime id is required.')
  await apiClient.request<void>(`/v1/library/anime/${encodeURIComponent(kitsuId)}`, { method: 'DELETE' })
}

export async function listManualPlaylists(): Promise<PlaylistDto[]> {
  const response = await apiClient.get<PlaylistDto[] | { playlists: PlaylistDto[] }>('/v1/playlists', {})
  const playlists = Array.isArray(response) ? response : response.playlists
  return playlists.filter((playlist) => !playlist.deleted && !playlist.isAuto)
}

export async function addThemesToPlaylist(
  playlistId: number,
  themeIds: readonly number[],
  modeOverride: PlaylistPlaybackMode | null = null,
): Promise<PlaylistDto> {
  return addItemsToPlaylist(playlistId, themeIds.map((itemId) => ({ itemType: 'THEME', itemId, modeOverride })))
}

export async function addItemsToPlaylist(playlistId: number, additions: readonly PlaylistItemInput[]): Promise<PlaylistDto> {
  assertPositiveId(playlistId, 'Playlist id')
  const playlist = (await listManualPlaylists()).find((item) => item.id === playlistId)
  if (!playlist) throw new Error('Playlist was not found.')
  const existingItems = playlist.items.length > 0
    ? playlist.items
    : playlist.entries.map((itemId) => ({ entryId: undefined, itemType: 'THEME' as const, itemId, modeOverride: null }))
  const validAdditions = additions
    .filter((item) => Number.isInteger(item.itemId) && item.itemId > 0)
    .map((item) => ({ itemType: item.itemType, itemId: item.itemId, modeOverride: item.itemType === 'SONG' ? null : item.modeOverride }))
  return updatePlaylistItems(playlistId, [...existingItems, ...validAdditions])
}

export async function createPlaylistWithThemes(input: { name: string; themeIds: readonly number[]; modeOverride?: PlaylistPlaybackMode | null }): Promise<PlaylistDto> {
  return createPlaylistWithItems({ name: input.name, items: input.themeIds.map((itemId) => ({ itemType: 'THEME', itemId, modeOverride: input.modeOverride ?? null })) })
}

export async function createPlaylistWithItems(input: { name: string; items: readonly PlaylistItemInput[] }): Promise<PlaylistDto> {
  const name = input.name.trim()
  if (!name) throw new Error('Playlist name is required.')
  const items = input.items.filter((item) => Number.isInteger(item.itemId) && item.itemId > 0).map((item) => ({ itemType: item.itemType, itemId: item.itemId, modeOverride: item.itemType === 'SONG' ? null : item.modeOverride }))
  const response = await apiClient.post<{ playlist: PlaylistDto }>('/v1/playlists', {
    name,
    items,
    defaultMode: 'TV_SIZE',
    overrideUserPreference: false,
    autoUpdate: false,
  } as unknown as JsonValue)
  return response.playlist
}

async function updatePlaylistItems(playlistId: number, items: PlaylistItemInput[]): Promise<PlaylistDto> {
  const response = await apiClient.request<{ playlist: PlaylistDto }>(`/v1/playlists/${playlistId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  return response.playlist
}

function assertPositiveId(value: number, label: string): asserts value is number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be positive.`)
}
