import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { AppQueryProvider, invalidateCategories, queryClient, useLibraryQuery } from './query'
import { apiClient } from './api'
import { AuthProvider } from '../auth/AuthProvider'

function LibraryProbe() {
  const query = useLibraryQuery()
  return <div><span data-testid="query-status">{query.status}</span><span data-testid="query-cursor">{query.library?.cursor ?? 'none'}</span></div>
}

describe('AppQueryProvider', () => {
  it('provides a React Query context to future server-backed routes', () => {
    render(<AppQueryProvider><span>query-ready</span></AppQueryProvider>)
    expect(screen.getByText('query-ready')).toBeInTheDocument()
  })

  describe('useLibraryQuery', () => {
    beforeEach(() => queryClient.clear())
    afterEach(() => vi.restoreAllMocks())

    it('loads the initial snapshot, then requests deltas from the stored server cursor', async () => {
      const get = vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
        if (path === '/auth/me') return { user: { kitsuUserId: '1', username: 'fan', displayName: null, avatarUrl: null }, kitsuAuthState: 'OK', lastSyncAt: null, devices: [] }
        if (path === '/v1/changes') return { serverTime: 100, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] }
        if (path === '/v1/changes?since=100') return { serverTime: 200, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] }
        throw new Error(`unexpected path ${path}`)
      })

      render(<AppQueryProvider><AuthProvider><LibraryProbe /></AuthProvider></AppQueryProvider>)
      await waitFor(() => expect(screen.getByTestId('query-cursor')).toHaveTextContent('100'))
      await queryClient.invalidateQueries({ queryKey: ['library'] })
      await waitFor(() => expect(screen.getByTestId('query-cursor')).toHaveTextContent('200'))

      expect(get).toHaveBeenCalledWith('/v1/changes', expect.anything())
      expect(get).toHaveBeenCalledWith('/v1/changes?since=100', expect.anything())
    })

    it('invalidates only the query families affected by live categories', () => {
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      invalidateCategories(['profile'])
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
      invalidate.mockClear()
      invalidateCategories(['library', 'playlist'])
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['library'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['playlists'] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['home'] })
    })
  })
})
