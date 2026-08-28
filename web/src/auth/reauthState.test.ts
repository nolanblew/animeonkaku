import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../lib/api'
import { createInitialQueueState, QueueStore } from '../player/queue'
import { AuthProvider, useAuth } from './AuthProvider'
import { captureReauthenticationState, restoreReauthenticationState } from './reauthState'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

describe('reauthentication state', () => {
  it('preserves the current route, queue context, position, and mode through reconnect', () => {
    const queue = new QueueStore()
    queue.play([
      { id: 'theme-1', title: 'Opening', audioUrl: '/audio/1' },
      { id: 'theme-2', title: 'Ending', audioUrl: '/audio/2' },
    ], { contextLabel: 'Anime 1', startIndex: 1 })

    const snapshot = captureReauthenticationState({
      route: '/playlist/7?track=2#now-playing',
      queueState: queue.state,
      currentTimeSeconds: 83,
      mode: 'FULL_SIZE',
      capturedAtMs: 10_000,
    })
    const restored = restoreReauthenticationState(snapshot, { nowMs: 10_500, maxAgeMs: 60_000 })

    expect(restored).toMatchObject({
      route: '/playlist/7?track=2#now-playing',
      currentTimeSeconds: 83,
      mode: 'FULL_SIZE',
      queueState: queue.state,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/password|token|cookie|secret/i)
  })

  it('drops stale reconnect snapshots instead of restoring expired playback state', () => {
    const snapshot = captureReauthenticationState({
      route: '/now-playing',
      queueState: createInitialQueueState(),
      currentTimeSeconds: 0,
      mode: 'TV_SIZE',
      capturedAtMs: 1_000,
    })

    expect(restoreReauthenticationState(snapshot, { nowMs: 70_001, maxAgeMs: 60_000 })).toBeUndefined()
  })

  it('keeps an authenticated user in place and exposes the current route when a session expires', async () => {
    window.history.replaceState({}, '', '/playlist/7?track=2#now-playing')
    const get = vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce({ user: { kitsuUserId: 'kitsu-1', username: 'fan', displayName: null, avatarUrl: null }, kitsuAuthState: 'OK', lastSyncAt: null, devices: [] })
      .mockRejectedValueOnce(Object.assign(new Error('expired'), { status: 401 }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(AuthProvider, null, createElement(AuthProbe))))
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))

    await waitFor(() => expect(screen.getByTestId('reauth-status')).toHaveTextContent('required'))
    expect(screen.getByTestId('auth-status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('reauth-route')).toHaveTextContent('/playlist/7?track=2#now-playing')
    expect(get).toHaveBeenCalledWith('/auth/me')
  })
})

function AuthProbe() {
  const auth = useAuth()
  return createElement('div', null,
    createElement('span', { 'data-testid': 'auth-status' }, auth.status),
    createElement('span', { 'data-testid': 'reauth-status' }, auth.reauthentication.status),
    createElement('span', { 'data-testid': 'reauth-route' }, auth.reauthentication.returnTo ?? 'none'),
    createElement('button', { type: 'button', onClick: () => void auth.refresh() }, 'Refresh session'),
  )
}
