import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { apiClient } from './api'
import { applyChanges, createEmptyLibrary, type ChangesResponse, type NormalizedLibrary } from './library'
import { LibraryLiveClient, type LiveChangeCategory } from './live'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export function AppQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export const LIBRARY_QUERY_KEY = ['library'] as const

export interface UseLibraryQueryOptions {
  enabled?: boolean
}

/**
 * Reads the full `/v1/changes` snapshot once, then uses the stored
 * `serverTime` as the cursor for every subsequent delta. The live stream only
 * carries invalidation hints; the HTTP feed remains the source of truth.
 */
export function useLibraryQuery(options: UseLibraryQueryOptions = {}) {
  const client = useQueryClient()
  const auth = useAuth()
  const queryEnabled = options.enabled === true || (options.enabled !== false && auth.status === 'authenticated')
  const query = useQuery<NormalizedLibrary>({
    queryKey: LIBRARY_QUERY_KEY,
    enabled: queryEnabled,
    queryFn: async ({ signal }) => {
      const previous = client.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)
      // Presence of cached normalized data, rather than a positive cursor,
      // distinguishes the first snapshot from a valid epoch-zero watermark.
      const since = previous ? previous.cursor : null
      const path = since === null ? '/v1/changes' : `/v1/changes?since=${encodeURIComponent(since)}`
      const response = await apiClient.get<ChangesResponse>(path, { signal })
      return applyChanges(previous ?? createEmptyLibrary(), response)
    },
    retry: (failureCount, error) => getStatus(error) !== 401 && failureCount < 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const userId = auth.user?.kitsuUserId ?? null
  const markInitialSyncReady = auth.markInitialSyncReady
  useEffect(() => {
    if (query.isSuccess) markInitialSyncReady()
  }, [markInitialSyncReady, query.isSuccess])

  useEffect(() => {
    if (getStatus(query.error) === 401) void auth.logout().catch(() => undefined)
  }, [auth.logout, query.error])

  const categoryHandler = useMemo(() => {
    return (categories: readonly LiveChangeCategory[]) => {
      invalidateCategories(categories, client)
    }
  }, [client])

  useEffect(() => {
    if (!queryEnabled || userId === null) return undefined
    const live = new LibraryLiveClient({
      url: apiClient.url('/v1/library/live'),
      initialCursor: client.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)?.cursor ?? null,
      onChange: (notification) => categoryHandler(notification.categories),
      onChanges: (changes) => {
        const current = client.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY) ?? createEmptyLibrary()
        client.setQueryData(LIBRARY_QUERY_KEY, applyChanges(current, changes))
        categoryHandler(changesCategories(changes))
      },
      onUnauthorized: () => { void auth.logout().catch(() => undefined) },
    })
    live.start(client.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)?.cursor ?? null)
    return () => {
      live.stop()
    }
  }, [auth.logout, categoryHandler, client, queryEnabled, userId])

  return { ...query, library: query.data ?? null }
}

export function invalidateCategories(categories: readonly LiveChangeCategory[], client: QueryClient = queryClient): void {
  if (categories.includes('library') || categories.includes('playlist')) {
    void client.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY })
  }
  if (categories.includes('playlist')) {
    void client.invalidateQueries({ queryKey: ['playlists'] })
  }
  if (categories.includes('profile')) {
    void client.invalidateQueries({ queryKey: ['auth', 'me'] })
  }
}

function changesCategories(changes: ChangesResponse): LiveChangeCategory[] {
  const categories: LiveChangeCategory[] = []
  if (changes.anime.length > 0 || changes.themes.length > 0 || changes.musicCatalog !== undefined) categories.push('library')
  if (changes.playlists.length > 0) categories.push('playlist')
  return categories
}

function getStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}
