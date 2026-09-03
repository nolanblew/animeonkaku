import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { invalidateCategories, LIBRARY_QUERY_KEY, queryClient } from '../../lib/query'
import type { NormalizedLibrary, PlaylistDto, PlaylistPlaybackMode, SongPrefDto, ThemePrefDto } from '../../lib/library'
import {
  addAnimeToLibrary,
  addItemsToPlaylist,
  addThemesToPlaylist,
  createPlaylistWithItems,
  createPlaylistWithThemes,
  removeAnimeFromLibrary,
  updateThemePreference,
  updateSongPreference,
  type PlaylistItemInput,
  type SongPreferencePatch,
  type ThemePreferencePatch,
} from './api'

export type LibraryActionKey = 'preference' | 'library' | 'playlist'

export interface LibraryActions {
  pendingAction: LibraryActionKey | null
  actionError: string | null
  updateThemePreference: (themeId: number, patch: ThemePreferencePatch) => Promise<unknown>
  updateSongPreference: (songId: number, patch: SongPreferencePatch) => Promise<unknown>
  setPreferredMode: (themeId: number, mode: PlaylistPlaybackMode | null) => Promise<unknown>
  addAnimeToLibrary: (input: { kitsuId?: string; animeThemesId?: number }) => Promise<unknown>
  removeAnimeFromLibrary: (kitsuId: string) => Promise<void>
  addThemesToPlaylist: (playlistId: number, themeIds: readonly number[], modeOverride?: PlaylistPlaybackMode | null) => Promise<PlaylistDto>
  createPlaylistWithThemes: (name: string, themeIds: readonly number[], modeOverride?: PlaylistPlaybackMode | null) => Promise<PlaylistDto>
  addItemsToPlaylist: (playlistId: number, items: readonly PlaylistItemInput[]) => Promise<PlaylistDto>
  createPlaylistWithItems: (name: string, items: readonly PlaylistItemInput[]) => Promise<PlaylistDto>
  clearActionError: () => void
}

/**
 * Thin browser action layer. It keeps mutation state local to the surface that
 * launched it, then invalidates the normalized library/playlist queries so the
 * SSE-backed cache remains the source of truth after a write.
 */
export function useLibraryActions(): LibraryActions {
  const [pendingAction, setPendingAction] = useState<LibraryActionKey | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = useCallback(async <T,>(key: LibraryActionKey, operation: () => Promise<T>, invalidate: () => void, optimistic?: () => (() => void) | void, commit?: (result: T) => void) => {
    setPendingAction(key)
    setActionError(null)
    let rollback: (() => void) | void = undefined
    try {
      rollback = optimistic?.()
      const result = await operation()
      commit?.(result)
      invalidate()
      return result
    } catch {
      rollback?.()
      setActionError('Could not complete that action.')
      throw new Error('Could not complete that action.')
    } finally {
      setPendingAction(null)
    }
  }, [])

  const invalidateLibrary = useCallback(() => invalidateCategories(['library'], queryClient), [])
  const invalidatePlaylist = useCallback(() => invalidateCategories(['playlist'], queryClient), [])
  const updatePreference = useCallback((themeId: number, patch: ThemePreferencePatch) => run('preference', () => updateThemePreference(themeId, patch), invalidateLibrary, () => optimisticallyUpdateThemePreference(queryClient, themeId, patch), (result) => commitThemePreference(queryClient, result)), [invalidateLibrary, run])
  const updateSong = useCallback((songId: number, patch: SongPreferencePatch) => run('preference', () => updateSongPreference(songId, patch), invalidateLibrary, () => optimisticallyUpdateSongPreference(queryClient, songId, patch), (result) => commitSongPreference(queryClient, result)), [invalidateLibrary, run])
  const setPreferredMode = useCallback((themeId: number, mode: PlaylistPlaybackMode | null) => updatePreference(themeId, { preferredMode: mode }), [updatePreference])
  const addLibrary = useCallback((input: { kitsuId?: string; animeThemesId?: number }) => run('library', () => addAnimeToLibrary(input), invalidateLibrary), [invalidateLibrary, run])
  const removeLibrary = useCallback((kitsuId: string) => run('library', () => removeAnimeFromLibrary(kitsuId), invalidateLibrary), [invalidateLibrary, run])
  const addPlaylistThemes = useCallback((playlistId: number, themeIds: readonly number[], modeOverride: PlaylistPlaybackMode | null = null) => run('playlist', () => addThemesToPlaylist(playlistId, themeIds, modeOverride), invalidatePlaylist), [invalidatePlaylist, run])
  const createPlaylistThemes = useCallback((name: string, themeIds: readonly number[], modeOverride: PlaylistPlaybackMode | null = null) => run('playlist', () => createPlaylistWithThemes({ name, themeIds, modeOverride }), invalidatePlaylist), [invalidatePlaylist, run])
  const addPlaylistItems = useCallback((playlistId: number, items: readonly PlaylistItemInput[]) => run('playlist', () => addItemsToPlaylist(playlistId, items), invalidatePlaylist), [invalidatePlaylist, run])
  const createPlaylistItems = useCallback((name: string, items: readonly PlaylistItemInput[]) => run('playlist', () => createPlaylistWithItems({ name, items }), invalidatePlaylist), [invalidatePlaylist, run])
  const clearActionError = useCallback(() => setActionError(null), [])

  return { pendingAction, actionError, updateThemePreference: updatePreference, updateSongPreference: updateSong, setPreferredMode, addAnimeToLibrary: addLibrary, removeAnimeFromLibrary: removeLibrary, addThemesToPlaylist: addPlaylistThemes, createPlaylistWithThemes: createPlaylistThemes, addItemsToPlaylist: addPlaylistItems, createPlaylistWithItems: createPlaylistItems, clearActionError }
}

function commitThemePreference(client: QueryClient, result: ThemePrefDto): void {
  client.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, (library) => {
    if (!library) return library
    const key = String(result.themeId)
    const current = library.prefsByThemeId[key]
    if (current && result.updatedAt < current.updatedAt) return library
    return { ...library, prefsByThemeId: { ...library.prefsByThemeId, [key]: { ...current, ...result } } }
  })
}

function commitSongPreference(client: QueryClient, result: SongPrefDto): void {
  client.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, (library) => {
    if (!library) return library
    const key = String(result.songId)
    const current = library.songPrefsById[key]
    if (current && result.updatedAt < current.updatedAt) return library
    return { ...library, songPrefsById: { ...library.songPrefsById, [key]: { ...current, ...result } } }
  })
}
function optimisticallyUpdateThemePreference(queryClient: QueryClient, themeId: number, patch: ThemePreferencePatch): (() => void) | undefined {
  const previous = queryClient.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)
  if (!previous) return undefined
  const key = String(themeId)
  const current: ThemePrefDto = previous.prefsByThemeId[key] ?? {
    themeId,
    liked: false,
    disliked: false,
    dislikedTvSize: false,
    dislikedFullSize: false,
    preferredMode: null,
    playCount: 0,
    lastPlayedAt: null,
    updatedAt: 0,
    deleted: false,
  }
  const next = applyThemePreferencePatch(current, patch)
  queryClient.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, {
    ...previous,
    prefsByThemeId: { ...previous.prefsByThemeId, [key]: next },
  })
  return () => queryClient.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, (latest) => {
    if (!latest) return latest
    const latestPreference = latest.prefsByThemeId[key]
    if (!latestPreference) return latest
    const prefsByThemeId = { ...latest.prefsByThemeId }
    prefsByThemeId[key] = rollbackThemePreference(latestPreference, current, next)
    return { ...latest, prefsByThemeId }
  })
}

function optimisticallyUpdateSongPreference(queryClient: QueryClient, songId: number, patch: SongPreferencePatch): (() => void) | undefined {
  const previous = queryClient.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)
  if (!previous) return undefined
  const key = String(songId)
  const current: SongPrefDto = previous.songPrefsById[key] ?? {
    songId,
    liked: false,
    disliked: false,
    playCount: 0,
    lastPlayedAt: null,
    updatedAt: 0,
    deleted: false,
  }
  const next: SongPrefDto = {
    ...current,
    ...patch,
    liked: patch.liked ?? current.liked,
    disliked: patch.disliked ?? current.disliked,
  }
  if (patch.liked === true) next.disliked = false
  if (patch.disliked === true) next.liked = false
  queryClient.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, {
    ...previous,
    songPrefsById: { ...previous.songPrefsById, [key]: next },
  })
  return () => queryClient.setQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY, (latest) => {
    if (!latest) return latest
    const latestPreference = latest.songPrefsById[key]
    if (!latestPreference) return latest
    const songPrefsById = { ...latest.songPrefsById }
    songPrefsById[key] = rollbackSongPreference(latestPreference, current, next)
    return { ...latest, songPrefsById }
  })
}

function rollbackThemePreference(latest: ThemePrefDto, previous: ThemePrefDto, optimistic: ThemePrefDto): ThemePrefDto {
  if (latest.updatedAt !== optimistic.updatedAt) return latest
  const rolledBack = { ...latest }
  if (previous.liked !== optimistic.liked && latest.liked === optimistic.liked) rolledBack.liked = previous.liked
  if (previous.disliked !== optimistic.disliked && latest.disliked === optimistic.disliked) rolledBack.disliked = previous.disliked
  if (previous.dislikedTvSize !== optimistic.dislikedTvSize && latest.dislikedTvSize === optimistic.dislikedTvSize) rolledBack.dislikedTvSize = previous.dislikedTvSize
  if (previous.dislikedFullSize !== optimistic.dislikedFullSize && latest.dislikedFullSize === optimistic.dislikedFullSize) rolledBack.dislikedFullSize = previous.dislikedFullSize
  if (previous.preferredMode !== optimistic.preferredMode && latest.preferredMode === optimistic.preferredMode) rolledBack.preferredMode = previous.preferredMode
  return rolledBack
}

function rollbackSongPreference(latest: SongPrefDto, previous: SongPrefDto, optimistic: SongPrefDto): SongPrefDto {
  if (latest.updatedAt !== optimistic.updatedAt) return latest
  const rolledBack = { ...latest }
  const keys = ['liked', 'disliked'] as const
  for (const key of keys) {
    if (previous[key] !== optimistic[key] && latest[key] === optimistic[key]) rolledBack[key] = previous[key]
  }
  return rolledBack
}

function applyThemePreferencePatch(current: ThemePrefDto, patch: ThemePreferencePatch): ThemePrefDto {
  const next: ThemePrefDto = { ...current, ...patch }
  if (patch.liked === true) {
    next.disliked = false
    next.dislikedTvSize = false
    next.dislikedFullSize = false
  }
  if (patch.disliked === true) {
    next.liked = false
    next.dislikedTvSize = false
    next.dislikedFullSize = false
  }
  if (patch.dislikedTvSize === true || patch.dislikedFullSize === true) {
    next.liked = false
    next.disliked = false
  }
  return next
}
