import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../../auth/AuthProvider'
import { SettingsPage } from './SettingsPage'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}))

const account = {
  kitsuUserId: 'kitsu-1',
  username: 'fan',
  displayName: 'Anime Fan',
  avatarUrl: null,
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: account,
    me: {
      user: account,
      kitsuAuthState: 'connected',
      lastSyncAt: null,
      devices: [],
    },
    firstSync: { status: 'ready', mode: null, syncMode: null, isNewUser: false },
    reauthentication: { status: 'idle', returnTo: null },
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(account),
    uploadAvatar: vi.fn().mockResolvedValue(account),
    removeAvatar: vi.fn().mockResolvedValue(account),
    markInitialSyncReady: vi.fn(),
    refresh: vi.fn(),
    requireReauthentication: vi.fn(),
  } as never)
})

describe('Phase 4 Home preference contract', () => {
  it('exposes the mobile Show OSTs on Home preference and lets the user toggle it', async () => {
    render(<MemoryRouter initialEntries={['/settings']}><Routes><Route path="/settings" element={<SettingsPage />} /></Routes></MemoryRouter>)

    const preference = screen.getByRole('checkbox', { name: 'Show OSTs on Home' })
    expect(preference).toBeChecked()

    await userEvent.click(preference)

    expect(preference).not.toBeChecked()
  })
})
