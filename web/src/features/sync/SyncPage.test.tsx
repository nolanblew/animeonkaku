import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthContextValue, FirstSyncState } from '../../auth/AuthProvider'
import { useAuth } from '../../auth/AuthProvider'
import { apiClient } from '../../lib/api'
import { SyncPage, type SyncStatus } from './SyncPage'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

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
        <Route path="/" element={<p>Library home</p>} />
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
  it('keeps polling queued catalog work when another catalog job has failed', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    const stages: SyncStatus['stages'] = {
      catalog: { state: 'FAILED', counts: { FAILED: 1, QUEUED: 1 }, updatedAt: null, lastCompletedAt: null, nextRetryAt: null, lastError: 'One anime could not be matched', failedJobIds: [42], attentionCount: 0, truncated: false },
    }
    vi.spyOn(apiClient, 'get')
      .mockResolvedValueOnce(makeStatus({ state: 'DONE', libraryState: 'DONE', stages }))
      .mockResolvedValue(makeStatus({ state: 'DONE', libraryState: 'DONE', stages: {
        catalog: { ...stages.catalog!, counts: { FAILED: 1, DONE: 1 } },
      } }))
    let pollCallback: (() => void) | null = null
    vi.spyOn(window, 'setInterval').mockImplementation((handler, delay) => {
      if (delay === 2_000) pollCallback = handler as () => void
      return 1
    })
    renderPage()
    expect(await screen.findByText('1 queued · 1 failed')).toBeInTheDocument()
    expect(screen.getByText('Kitsu library updated')).toBeInTheDocument()
    await waitFor(() => expect(pollCallback).not.toBeNull())
    await act(async () => { pollCallback?.() })
    expect(await screen.findByText('1 failed · 1 complete')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledTimes(2)
  })

  it('describes an idle background stage without exposing queue storage details', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    mockStatus(makeStatus({ stages: {
      catalog: { state: 'IDLE', counts: {}, updatedAt: null, lastCompletedAt: null, nextRetryAt: null, lastError: null, failedJobIds: [], attentionCount: 0, truncated: false },
    } }))
    renderPage()
    expect(await screen.findByText('No updates yet')).toBeInTheDocument()
  })

  it('does not invent a percentage when the server has no progress totals', async () => {
    mockedUseAuth.mockReturnValue(makeAuth())
    mockStatus(makeStatus({ state: 'RUNNING', phase: 'SYNCING_LIBRARY' }))
    renderPage()
    const progress = await screen.findByRole('progressbar', { name: /library sync progress/i })
    expect(progress).not.toHaveAttribute('aria-valuenow')
    expect(progress).toHaveAttribute('aria-valuetext', 'Syncing library')
  })
  it('shows a completed import separately from failed mapping and retries only that stage', async () => {
    const auth = makeAuth()
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({
      state: 'QUEUED', phase: 'MAPPING_THEMES', libraryState: 'DONE',
      stages: {
        catalog: { state: 'FAILED', counts: { FAILED: 1, DONE: 664 }, updatedAt: Date.UTC(2026, 9, 21), lastCompletedAt: Date.UTC(2026, 9, 21), nextRetryAt: null, lastError: 'AnimeThemes HTTP 403', failedJobIds: [42], attentionCount: 2, truncated: false },
        playlists: { state: 'QUEUED', counts: { QUEUED: 1 }, updatedAt: Date.UTC(2026, 9, 21), lastCompletedAt: null, nextRetryAt: Date.UTC(2026, 9, 21, 12), lastError: 'Temporary database failure', failedJobIds: [], attentionCount: 0, truncated: false },
      },
    }))
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ retried: 1 })
    renderPage()
    expect(await screen.findByRole('heading', { name: /sync complete.*library is ready/i })).toBeInTheDocument()
    const catalog = screen.getByRole('region', { name: 'Theme catalog matching' })
    expect(within(catalog).getByText('1 failed · 664 complete')).toBeInTheDocument()
    expect(within(catalog).getByText(/2 catalog items have no matching metadata/i)).toBeInTheDocument()
    expect(screen.getByText(/automatic retry scheduled/i)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sync failed' })).not.toBeInTheDocument()
    await userEvent.setup().click(within(catalog).getByRole('button', { name: /retry theme catalog matching/i }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/sync/stages/catalog/retry', {}))
  })

  it('opens a first-time library once import completes while mapping continues', async () => {
    const auth = makeAuth({ firstSync: { status: 'syncing', mode: 'FULL', syncMode: 'FULL', isNewUser: true } })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({ state: 'RUNNING', phase: 'MAPPING_THEMES', libraryState: 'DONE' }))
    renderPage()
    expect(await screen.findByText('Library home')).toBeInTheDocument()
    expect(auth.markInitialSyncReady).toHaveBeenCalledTimes(1)
  })
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
    expect(screen.getByText(/40 of 100 titles/i)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /library sync progress/i })).toHaveAttribute('aria-valuenow', '40')
    expect(screen.queryByText(/page 2\s*(of|\/)\s*5/i)).not.toBeInTheDocument()
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

  it('opens the library automatically when a first-time sync completes', async () => {
    const auth = makeAuth({
      firstSync: { status: 'syncing', mode: 'FULL', syncMode: 'FULL', isNewUser: true },
    })
    mockedUseAuth.mockReturnValue(auth)
    mockStatus(makeStatus({ state: 'DONE', phase: 'DONE' }))
    renderPage()

    expect(await screen.findByText('Library home')).toBeInTheDocument()
    expect(auth.markInitialSyncReady).toHaveBeenCalledTimes(1)
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
    expect(screen.getByText(/60 of 100 titles/i)).toBeInTheDocument()
    expect(screen.getByText(/2 anime could not be matched yet/i)).toBeInTheDocument()
    expect(screen.queryByText('One Piece')).not.toBeInTheDocument()
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
    let rejectPoll!: (reason: Error) => void
    vi.spyOn(apiClient, 'get').mockImplementation(async () => {
      reads += 1
      if (reads === 1) return makeStatus({ state: 'RUNNING', phase: 'MAPPING_THEMES' })
      return new Promise((_, reject) => { rejectPoll = reject })
    })
    let pollCallback: (() => void) | null = null
    const setInterval = vi.spyOn(window, 'setInterval').mockImplementation((handler) => {
      pollCallback = handler as () => void
      return 1
    })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Library sync' })).toBeInTheDocument()
    await waitFor(() => expect(setInterval).toHaveBeenCalled())
    ;(pollCallback as (() => void) | null)?.()
    await waitFor(() => expect(reads).toBe(2))
    await act(async () => { rejectPoll(new Error('poll unavailable')) })
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
