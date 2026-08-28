import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../lib/api'
import { AuthProvider, useAuth } from './AuthProvider'

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="name">{auth.user?.displayName ?? auth.user?.username ?? 'guest'}</span>
      <span data-testid="sync">{auth.firstSync.status}</span>
      <button onClick={() => void auth.login('fan', 'password')}>login</button>
      <button onClick={() => void auth.updateProfile({ displayName: 'Nolan' })}>profile</button>
      <button onClick={() => void auth.uploadAvatar(new Blob(['avatar'], { type: 'image/png' }))}>avatar</button>
      <button onClick={() => void auth.removeAvatar()}>remove avatar</button>
      <button onClick={() => void auth.logout()}>logout</button>
    </div>
  )
}

function renderAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={queryClient}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>), queryClient }
}

afterEach(() => vi.restoreAllMocks())

describe('AuthProvider', () => {
  it('resolves the browser session from /api/auth/me without persisting credentials', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ user: { kitsuUserId: '1', username: 'fan', displayName: 'Anime Fan', avatarUrl: null }, kitsuAuthState: 'OK', lastSyncAt: 100, devices: [] })
    renderAuth()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(screen.getByTestId('name')).toHaveTextContent('Anime Fan')
  })

  it('performs login, profile update, and logout through cookie-authenticated methods', async () => {
    const get = vi.spyOn(apiClient, 'get').mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }))
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ user: { kitsuUserId: '1', username: 'fan', displayName: null, avatarUrl: null }, isNewUser: true, syncMode: 'FULL' })
      .mockResolvedValueOnce(undefined)
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ profile: { displayName: 'Nolan', avatarUrl: null } })
    const postRaw = vi.spyOn(apiClient, 'postRaw').mockResolvedValue({ profile: { displayName: 'Nolan', avatarUrl: '/api/auth/profile/avatar' } })
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ profile: { displayName: 'Nolan', avatarUrl: null } })
    const { queryClient } = renderAuth()
    queryClient.setQueryData(['playlists'], [{ id: 7, name: 'Previous account' }])
    queryClient.setQueryData(['playlist', 7], { id: 7, name: 'Previous account' })
    queryClient.setQueryData(['home'], { sections: [{ id: 'private' }] })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'login' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('sync')).toHaveTextContent('syncing')
    expect(post).toHaveBeenCalledWith('/auth/login', {
      username: 'fan',
      password: 'password',
      deviceName: expect.stringMatching(/^Web(?: browser| · (?:Windows|macOS|Linux|iOS|Android))$/),
    })

    await user.click(screen.getByRole('button', { name: 'profile' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/auth/profile', { displayName: 'Nolan' }))
    expect(screen.getByTestId('name')).toHaveTextContent('Nolan')

    await user.click(screen.getByRole('button', { name: 'avatar' }))
    await waitFor(() => expect(postRaw).toHaveBeenCalledWith('/auth/profile/avatar', expect.any(Blob)))
    await user.click(screen.getByRole('button', { name: 'remove avatar' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/auth/profile/avatar', { method: 'DELETE' }))

    await user.click(screen.getByRole('button', { name: 'logout' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'))
    expect(post).toHaveBeenLastCalledWith('/auth/logout')
    expect(get).toHaveBeenCalled()
    expect(queryClient.getQueryData(['playlists'])).toBeUndefined()
    expect(queryClient.getQueryData(['playlist', 7])).toBeUndefined()
    expect(queryClient.getQueryData(['home'])).toBeUndefined()
  })
})
