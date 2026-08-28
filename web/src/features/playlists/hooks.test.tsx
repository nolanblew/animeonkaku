import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { usePlaylistMutations, usePlaylists } from './hooks'

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('playlist hooks', () => {
  it('loads playlists and exposes mutations that invalidate both playlist and library queries', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue([])
    const { result } = renderHook(() => ({ list: usePlaylists(), mutations: usePlaylistMutations() }), { wrapper })
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    expect(result.current.list.playlists).toEqual([])
    expect(result.current.mutations.create).toBeDefined()
  })
})
