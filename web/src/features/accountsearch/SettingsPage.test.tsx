import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthContextValue } from '../../auth/AuthProvider'
import { useAuth } from '../../auth/AuthProvider'
import { SettingsPage } from './SettingsPage'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'authenticated',
    user: { kitsuUserId: 'kitsu-1', username: 'fan', displayName: 'Anime Fan', avatarUrl: '/avatar.png' },
    me: {
      user: { kitsuUserId: 'kitsu-1', username: 'fan', displayName: 'Anime Fan', avatarUrl: '/avatar.png' },
      kitsuAuthState: 'connected', lastSyncAt: Date.UTC(2026, 7, 25),
      devices: [{ id: 1, deviceName: 'Chrome on Windows', createdAt: 1, lastUsedAt: Date.UTC(2026, 7, 26), current: true }],
    },
    firstSync: { status: 'ready', mode: null, syncMode: null, isNewUser: false },
    reauthentication: { status: 'idle', returnTo: null },
    login: vi.fn(), logout: vi.fn().mockResolvedValue(undefined), updateProfile: vi.fn().mockResolvedValue({ displayName: 'Updated', avatarUrl: '/avatar.png' }),
    uploadAvatar: vi.fn().mockResolvedValue({ displayName: 'Anime Fan', avatarUrl: '/new-avatar.png' }),
    removeAvatar: vi.fn().mockResolvedValue({ displayName: 'Anime Fan', avatarUrl: null }),
    markInitialSyncReady: vi.fn(), refresh: vi.fn(), requireReauthentication: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(<MemoryRouter initialEntries={['/settings']}><Routes><Route path="/settings" element={<SettingsPage />} /><Route path="/login" element={<p>Login route</p>} /></Routes></MemoryRouter>)
}

afterEach(() => vi.restoreAllMocks())

beforeEach(() => mockedUseAuth.mockReturnValue(makeAuth()))

describe('SettingsPage', () => {
  it('renders account, Kitsu, sync, and device details and updates the display name', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeInTheDocument()
    expect(screen.getByText('fan')).toBeInTheDocument()
    expect(screen.getByText('kitsu-1')).toBeInTheDocument()
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: /display name/i })
    await user.clear(input)
    await user.type(input, 'Updated')
    await user.click(screen.getByRole('button', { name: /save display name/i }))
    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledWith({ displayName: 'Updated' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('validates avatar type and size before upload, then accepts a valid image', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    const user = userEvent.setup()
    renderPage()
    const input = screen.getByLabelText(/upload avatar/i)

    fireEvent.change(input, { target: { files: [new File(['not image'], 'notes.txt', { type: 'text/plain' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent(/png.*jpeg.*webp.*gif/i)
    expect(auth.uploadAvatar).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent(/2 mib/i)
    expect(auth.uploadAvatar).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] } })
    await waitFor(() => expect(auth.uploadAvatar).toHaveBeenCalledWith(expect.any(Blob)))
  })

  it('removes the current avatar and logs out through AuthProvider', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /remove avatar/i }))
    await waitFor(() => expect(auth.removeAvatar).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Login route')).toBeInTheDocument()
  })

  it('handles profile and avatar service failures with safe messages', async () => {
    const auth = makeAuth({
      updateProfile: vi.fn().mockRejectedValue(new Error('private profile failure')),
      uploadAvatar: vi.fn().mockRejectedValue(new Error('private upload failure')),
      removeAvatar: vi.fn().mockRejectedValue(new Error('private remove failure')),
    })
    mockedUseAuth.mockReturnValue(auth)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /save display name/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
    const input = screen.getByLabelText(/upload avatar/i)
    fireEvent.change(input, { target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not upload/i)
    await user.click(screen.getByRole('button', { name: /remove avatar/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not remove/i)
    expect(screen.queryByText(/private/i)).not.toBeInTheDocument()
  })

  it('renders a safe empty account state when the session profile is unavailable', () => {
    mockedUseAuth.mockReturnValue(makeAuth({ user: null, me: null }))
    renderPage()
    expect(screen.getByText(/details are not available/i)).toBeInTheDocument()
  })
})
