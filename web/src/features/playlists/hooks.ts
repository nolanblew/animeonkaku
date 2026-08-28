import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { PlaylistDto } from '../../lib/library'
import { createPlaylist, deletePlaylist, listPlaylists, refreshPlaylistSnapshot, updatePlaylist, updatePlaylistSpec, type PlaylistCreateInput } from './api'
import type { PlaylistItemInput, PlaylistUpdateInput } from './model'

export const PLAYLISTS_QUERY_KEY = ['playlists'] as const

export interface UsePlaylistsOptions {
  enabled?: boolean
  since?: number | null
}

export function usePlaylists(options: UsePlaylistsOptions = {}) {
  const query = useQuery<PlaylistDto[]>({
    queryKey: options.since === undefined ? PLAYLISTS_QUERY_KEY : [...PLAYLISTS_QUERY_KEY, options.since],
    queryFn: () => listPlaylists(options.since ?? null),
    enabled: options.enabled !== false,
    staleTime: 30_000,
    retry: 1,
  })
  return { ...query, playlists: query.data ?? [] }
}

export function usePlaylist(id: number | null, options: { enabled?: boolean } = {}) {
  const client = useQueryClient()
  const list = client.getQueryData<PlaylistDto[]>(PLAYLISTS_QUERY_KEY)
  const query = useQuery<PlaylistDto | null>({
    queryKey: ['playlist', id],
    queryFn: async () => {
      const playlists = await listPlaylists()
      const result = playlists.find((playlist) => playlist.id === id && !playlist.deleted) ?? null
      client.setQueryData(PLAYLISTS_QUERY_KEY, playlists)
      return result
    },
    enabled: id !== null && id > 0 && options.enabled !== false,
    initialData: list?.find((playlist) => playlist.id === id && !playlist.deleted) ?? undefined,
    staleTime: 30_000,
    retry: 1,
  })
  return { ...query, playlist: query.data ?? null }
}

export interface PlaylistMutationApi {
  create: (input: PlaylistCreateInput) => Promise<PlaylistDto>
  update: (id: number, input: Partial<PlaylistUpdateInput> & { items?: PlaylistItemInput[] }) => Promise<PlaylistDto>
  updateSpec: (id: number, spec: unknown) => Promise<PlaylistDto>
  refresh: (id: number) => Promise<PlaylistDto>
  remove: (id: number) => Promise<void>
  createState: UseMutationResult<PlaylistDto, Error, PlaylistCreateInput>
  updateState: UseMutationResult<PlaylistDto, Error, { id: number; input: Partial<PlaylistUpdateInput> & { items?: PlaylistItemInput[] } }>
  updateSpecState: UseMutationResult<PlaylistDto, Error, { id: number; spec: unknown }>
  refreshState: UseMutationResult<PlaylistDto, Error, number>
  removeState: UseMutationResult<void, Error, number>
}

export function usePlaylistMutations(): PlaylistMutationApi {
  const client = useQueryClient()
  const syncPlaylist = (playlist: PlaylistDto) => {
    client.setQueryData<PlaylistDto[]>(PLAYLISTS_QUERY_KEY, (current) => {
      const next = current ? [...current] : []
      const index = next.findIndex((item) => item.id === playlist.id)
      if (index === -1) next.push(playlist)
      else next[index] = playlist
      return next
    })
    client.setQueryData(['playlist', playlist.id], playlist)
  }
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: PLAYLISTS_QUERY_KEY })
    void client.invalidateQueries({ queryKey: ['library'] })
  }

  const createState = useMutation({ mutationFn: createPlaylist, onSuccess: (playlist) => { syncPlaylist(playlist); invalidate() } })
  const updateState = useMutation({
    mutationFn: ({ id, input }: { id: number; input: Partial<PlaylistUpdateInput> & { items?: PlaylistItemInput[] } }) => updatePlaylist(id, input),
    onSuccess: (playlist) => { syncPlaylist(playlist); invalidate() },
  })
  const updateSpecState = useMutation({
    mutationFn: ({ id, spec }: { id: number; spec: unknown }) => updatePlaylistSpec(id, spec),
    onSuccess: (playlist) => { syncPlaylist(playlist); invalidate() },
  })
  const refreshState = useMutation({
    mutationFn: refreshPlaylistSnapshot,
    onSuccess: (playlist) => { syncPlaylist(playlist); invalidate() },
  })
  const removeState = useMutation({
    mutationFn: deletePlaylist,
    onSuccess: (_, id) => {
      client.setQueryData<PlaylistDto[]>(PLAYLISTS_QUERY_KEY, (current) => current?.filter((playlist) => playlist.id !== id) ?? [])
      client.removeQueries({ queryKey: ['playlist', id] })
      invalidate()
    },
  })

  return useMemo(() => ({
    create: createState.mutateAsync,
    update: (id, input) => updateState.mutateAsync({ id, input }),
    updateSpec: (id, spec) => updateSpecState.mutateAsync({ id, spec }),
    refresh: refreshState.mutateAsync,
    remove: removeState.mutateAsync,
    createState,
    updateState,
    updateSpecState,
    refreshState,
    removeState,
  }), [createState, refreshState, removeState, updateSpecState, updateState])
}
