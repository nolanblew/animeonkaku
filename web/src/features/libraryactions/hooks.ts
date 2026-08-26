import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateCategories } from '../../lib/query'
import type { PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import {
  addAnimeToLibrary,
  addThemesToPlaylist,
  createPlaylistWithThemes,
  removeAnimeFromLibrary,
  updateThemePreference,
  type ThemePreferencePatch,
} from './api'

export type LibraryActionKey = 'preference' | 'library' | 'playlist'

export interface LibraryActions {
  pendingAction: LibraryActionKey | null
  actionError: string | null
  updateThemePreference: (themeId: number, patch: ThemePreferencePatch) => Promise<unknown>
  setPreferredMode: (themeId: number, mode: PlaylistPlaybackMode | null) => Promise<unknown>
  addAnimeToLibrary: (input: { kitsuId?: string; animeThemesId?: number }) => Promise<unknown>
  removeAnimeFromLibrary: (kitsuId: string) => Promise<void>
  addThemesToPlaylist: (playlistId: number, themeIds: readonly number[], modeOverride?: PlaylistPlaybackMode | null) => Promise<PlaylistDto>
  createPlaylistWithThemes: (name: string, themeIds: readonly number[], modeOverride?: PlaylistPlaybackMode | null) => Promise<PlaylistDto>
  clearActionError: () => void
}

/**
 * Thin browser action layer. It keeps mutation state local to the surface that
 * launched it, then invalidates the normalized library/playlist queries so the
 * SSE-backed cache remains the source of truth after a write.
 */
export function useLibraryActions(): LibraryActions {
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<LibraryActionKey | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const run = useCallback(async <T,>(key: LibraryActionKey, operation: () => Promise<T>, invalidate: () => void) => {
    setPendingAction(key)
    setActionError(null)
    try {
      const result = await operation()
      invalidate()
      return result
    } catch {
      setActionError('Could not complete that action.')
      throw new Error('Could not complete that action.')
    } finally {
      setPendingAction(null)
    }
  }, [])

  const invalidateLibrary = useCallback(() => invalidateCategories(['library'], queryClient), [queryClient])
  const invalidatePlaylist = useCallback(() => invalidateCategories(['playlist'], queryClient), [queryClient])
  const updatePreference = useCallback((themeId: number, patch: ThemePreferencePatch) => run('preference', () => updateThemePreference(themeId, patch), invalidateLibrary), [invalidateLibrary, run])
  const setPreferredMode = useCallback((themeId: number, mode: PlaylistPlaybackMode | null) => updatePreference(themeId, { preferredMode: mode }), [updatePreference])
  const addLibrary = useCallback((input: { kitsuId?: string; animeThemesId?: number }) => run('library', () => addAnimeToLibrary(input), invalidateLibrary), [invalidateLibrary, run])
  const removeLibrary = useCallback((kitsuId: string) => run('library', () => removeAnimeFromLibrary(kitsuId), invalidateLibrary), [invalidateLibrary, run])
  const addPlaylistThemes = useCallback((playlistId: number, themeIds: readonly number[], modeOverride: PlaylistPlaybackMode | null = null) => run('playlist', () => addThemesToPlaylist(playlistId, themeIds, modeOverride), invalidatePlaylist), [invalidatePlaylist, run])
  const createPlaylistThemes = useCallback((name: string, themeIds: readonly number[], modeOverride: PlaylistPlaybackMode | null = null) => run('playlist', () => createPlaylistWithThemes({ name, themeIds, modeOverride }), invalidatePlaylist), [invalidatePlaylist, run])
  const clearActionError = useCallback(() => setActionError(null), [])

  return { pendingAction, actionError, updateThemePreference: updatePreference, setPreferredMode, addAnimeToLibrary: addLibrary, removeAnimeFromLibrary: removeLibrary, addThemesToPlaylist: addPlaylistThemes, createPlaylistWithThemes: createPlaylistThemes, clearActionError }
}
