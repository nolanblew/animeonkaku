import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContextValue, FirstSyncState } from '../../auth/AuthProvider'
import { useAuth } from '../../auth/AuthProvider'
import { apiClient } from '../../lib/api'
import { SyncPage } from './SyncPage'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

type SyncStatus = {
  state: 'IDLE' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'
  phase: string | null
  progress: Record<string, unknown>
  lastCompletedAt: number | null
  unmatched: string[]
  mapping: { state: string; lastError: string | null } | null
  upstreamBlocked: boolean
}

function makeStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
  return {
    state: 'IDLE',
    phase: null,
    progress: {},
    lastCompletedAt: null,
    unmatched: [],
    mapping: null,
    upstreamBlocked: false,
    ...overrides,
  }
}

function makeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const firstSync: FirstSyncState = {
    status: 'ready',
    mode: null,
    syncMode: null,
    isNewUser: false,
  }
  return {
    status: 'authenticated',
    user: { kitsuUserId: 'kitsu-1', username: 'fan', displayName: 'Anime Fan', avatarUrl: null },
    me: {
      user: { kitsuUserId: 'kitsu-1', username: 'fan', displayName: 'Anime Fan', avatarUrl: null },
      kitsuAuthState: 'OK',
      lastSyncAt: Date.UTC(2026, 7, 26),
      devices: [],
    },
    firstSync,
    reauthentication: { status: 'idle', returnTo: null },
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn(),
    uploadAvatar: vi.fn(),
    removeAvatar: vi.fn(),
    markInitialSyncReady: vi.fn(),
    requireReauthentication: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sync']}>
      <Routes>
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/login" element={<p>Login route</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockStatus(status: SyncStatus) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
    if (path === '/v1/sync/status') return status
    throw new Error(`Unexpected GET ${path}`)
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SyncPage authenticated Kitsu sync lifecycle', () => {
  it('gates first-sync controls and shows Full progress until the server reports completion', async () => {
    const auth = makeAuth({
      firstSync: { status: 'syncing', mode: 'FULL', syncMode: 'FULL', isNewUser: true },
    })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({
      state: 'RUNNING',
      phase: 'SYNCING_LIBRARY',
      progress: { page: 2, totalPages: 5, fetchedCount: 40, totalCount: 100 },
    }))
    renderPage()

    expect(await screen.findByRole('heading', { name: /first sync|syncing your library/i })).toBeInTheDocument()
    expect(screen.getByText(/full sync/i)).toBeInTheDocument()
    expect(screen.getByText(/40\s*\/\s*100/)).toBeInTheDocument()
    expect(screen.getByText(/page 2\s*(of|\/)\s*5/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sync now|sync library/i })).not.toBeInTheDocument()
    expect(auth.markInitialSyncReady).not.toHaveBeenCalled()
    expect(apiClient.get).toHaveBeenCalledWith('/v1/sync/status')
  })

  it('distinguishes a Delta first sync and marks AuthProvider ready only after DONE', async () => {
    const auth = makeAuth({
      firstSync: { status: 'syncing', mode: 'DELTA', syncMode: 'DELTA', isNewUser: false },
    })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({
      state: 'DONE',
      phase: 'DONE',
      progress: { total: 12, mapped: 10, unmatched: ['Naruto'] },
      lastCompletedAt: Date.UTC(2026, 7, 27),
      unmatched: ['Naruto'],
    }))
    renderPage()

    expect(await screen.findByText(/delta sync/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /sync complete/i })).toBeInTheDocument()
    expect(screen.getByText(/10\s*(mapped|themes)/i)).toBeInTheDocument()
    await waitFor(() => expect(auth.markInitialSyncReady).toHaveBeenCalledTimes(1))
  })

  it('starts an ordinary Sync now as a Delta enqueue through the authenticated server route', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus())
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ jobId: 17 })
    renderPage()

    await userEvent.setup().click(await screen.findByRole('button', { name: /sync now|sync library/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/sync', { full: false }))
  })

  it('requires confirmation before a Full re-sync and then enqueues full=true', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    mockStatus(makeStatus())
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ jobId: 18 })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /re-sync all|full re-sync/i }))
    const dialog = await screen.findByRole('dialog', { name: /re-sync|full sync/i })
    expect(within(dialog).getByText(/existing library data|play counts|history/i)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /re-sync all|full re-sync/i }))
    const reopened = await screen.findByRole('dialog', { name: /re-sync|full sync/i })
    await user.click(within(reopened).getByRole('button', { name: /re-sync|confirm/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/sync', { full: true }))
  })

  it('retains partial data context, reports unmatched/upstream-blocked failures, and retries with the prior mode', async () => {
    const auth = makeAuth({
      firstSync: { status: 'ready', mode: 'DELTA', syncMode: 'DELTA', isNewUser: false },
    })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({
      state: 'FAILED',
      phase: 'MAPPING_THEMES',
      progress: { total: 100, processed: 60 },
      unmatched: ['One Piece', 'Bleach'],
      mapping: { state: 'FAILED', lastError: 'AnimeThemes request failed with HTTP 403: cloudflare' },
      upstreamBlocked: true,
    }))
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ jobId: 19 })
    renderPage()

    expect(await screen.findByRole('heading', { name: /sync failed|could not complete/i })).toBeInTheDocument()
    expect(screen.getByText(/60\s*\/\s*100/)).toBeInTheDocument()
    expect(screen.getByText('One Piece')).toBeInTheDocument()
    expect(screen.getByText('Bleach')).toBeInTheDocument()
    expect(screen.getByText(/upstream|animethemes.*blocked|cloudflare/i)).toBeInTheDocument()
    expect(screen.getByText(/existing library data remains available|partial library/i)).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: /retry sync/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/sync', { full: false }))
  })

  it('unlinks locally through logout because the server contract has no account-unlink endpoint', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus())
    renderPage()

    await userEvent.setup().click(await screen.findByRole('button', { name: /unlink kitsu|unlink account/i }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1))
  })

  it('reports an initial status read failure', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('status unavailable'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read the current sync status/i)
    expect(screen.getByRole('heading', { name: 'Library sync' })).toBeInTheDocument()
  })

  it('reports transient polling failures while keeping the active sync visible', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    let reads = 0
    vi.spyOn(apiClient, 'get').mockImplementation(async () => {
      reads += 1
      if (reads === 1) return makeStatus({ state: 'RUNNING', phase: 'MAPPING_THEMES' })
      throw new Error('poll unavailable')
    })
    let pollCallback: (() => void) | null = null
    const setInterval = vi.spyOn(window, 'setInterval').mockImplementation((handler) => {
      pollCallback = handler as () => void
      return 1
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Library sync' })).toBeInTheDocument()
    await waitFor(() => expect(setInterval).toHaveBeenCalled())
    await act(async () => { pollCallback?.(); await Promise.resolve() })
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not refresh sync progress/i)
    expect(reads).toBe(2)
  })

  it('surfaces an enqueue failure and clears the pending state', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    mockStatus(makeStatus())
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('enqueue unavailable'))
    renderPage()

    await userEvent.setup().click(await screen.findByRole('button', { name: /sync now|sync library/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start the sync/i)
    expect(screen.getByRole('button', { name: /sync now|sync library/i })).toBeEnabled()
  })

  it('navigates to login even when logout rejects', async () => {
    const auth = makeAuth({ logout: vi.fn().mockRejectedValue(new Error('logout unavailable')) })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus())
    renderPage()

    await userEvent.setup().click(await screen.findByRole('button', { name: /unlink kitsu|unlink account/i }))
    expect(await screen.findByText('Login route')).toBeInTheDocument()
  })
})
