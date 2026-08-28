import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { apiClient } from '../../lib/api'
import librarySyncIllustration from '../../assets/library-sync.webp'
import './sync.css'

const SYNC_POLL_INTERVAL_MS = 2_000

export type SyncJobState = 'IDLE' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED'

export interface SyncMappingStatus {
  state: string
  lastError: string | null
}

export interface SyncStatus {
  state: SyncJobState
  phase: string | null
  progress: Record<string, unknown>
  lastCompletedAt: number | null
  unmatched: string[]
  mapping: SyncMappingStatus | null
  upstreamBlocked: boolean
}

interface SyncQueuedResponse {
  jobId: number
}

type SyncMode = 'FULL' | 'DELTA' | 'NONE'

export function SyncPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingMode, setPendingMode] = useState<SyncMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showFullConfirmation, setShowFullConfirmation] = useState(false)
  const completionHandled = useRef(false)
  const modeRef = useRef<SyncMode | null>(auth.firstSync.mode)

  const readStatus = useCallback(async () => {
    const next = await apiClient.get<SyncStatus>('/v1/sync/status')
    setStatus(next)
    setError(null)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void apiClient.get<SyncStatus>('/v1/sync/status')
      .then((next) => {
        if (cancelled) return
        setStatus(next)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('We could not read the current sync status. Try again in a moment.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!status || !isActive(status.state)) return undefined
    const timer = window.setInterval(() => {
      void readStatus().catch(() => {
        setError('We could not refresh sync progress. We will keep trying.')
      })
    }, SYNC_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [readStatus, status])

  useEffect(() => {
    if (!status || status.state !== 'DONE' || auth.firstSync.status !== 'syncing' || completionHandled.current) return
    completionHandled.current = true
    const shouldOpenLibrary = auth.firstSync.isNewUser
    auth.markInitialSyncReady()
    if (shouldOpenLibrary) {
      const returnTo = typeof location.state === 'object' && location.state !== null && 'from' in location.state && typeof location.state.from === 'string'
        ? location.state.from
        : '/'
      navigate(returnTo, { replace: true })
    }
  }, [auth, location.state, navigate, status])

  const enqueue = async (full: boolean) => {
    const mode: SyncMode = full ? 'FULL' : 'DELTA'
    modeRef.current = mode
    setPendingMode(mode)
    setError(null)
    setShowFullConfirmation(false)
    try {
      await apiClient.post<SyncQueuedResponse>('/v1/sync', { full })
      setStatus((current) => current ? { ...current, state: 'QUEUED', phase: null } : current)
      await readStatus()
    } catch {
      setError('We could not start the sync. Try again in a moment.')
    } finally {
      setPendingMode(null)
    }
  }

  const mode = modeRef.current ?? auth.firstSync.mode ?? null
  const isFirstSync = auth.firstSync.status === 'syncing' && auth.firstSync.isNewUser
  const isWorking = pendingMode !== null || (status !== null && isActive(status.state))
  const canShowControls = !isFirstSync || !isWorking
  const title = status?.state === 'DONE' ? 'Sync complete — your library is ready' : isFirstSync ? 'Syncing your library' : 'Library sync'

  return (
    <section className="sync-page" aria-labelledby="sync-page-title" aria-busy={loading || isWorking}>
      <div className="sync-page__hero">
        <img className="sync-page__art" src={librarySyncIllustration} alt="" aria-hidden="true" />
        <div className="sync-page__hero-copy">
          <header className="sync-page__header">
            <p className="sync-page__eyebrow">Kitsu connection</p>
            <h1 id="sync-page-title">{title}</h1>
            <p>{isFirstSync ? 'We are bringing over your shows and matching their music. You can leave this tab open—we will take it from here.' : 'Keep your Anime Ongaku library current across devices.'}</p>
          </header>

          {loading && <p role="status">Checking sync status…</p>}
          {status && <SyncStatusCard status={status} mode={mode} />}
          {isFirstSync && isWorking && <p className="sync-page__hint" role="status">This usually only takes a moment. Your library will open automatically.</p>}
        </div>
      </div>

      {error && <p className="sync-page__feedback sync-page__feedback--error" role="alert">{error}</p>}

      {status?.state === 'FAILED' && (
        <section className="sync-page__notice" aria-labelledby="sync-failure-title">
          <h2 id="sync-failure-title">Sync failed</h2>
          <p>Your existing library data remains available while you retry.</p>
          {status.upstreamBlocked && <p>Theme matching is currently blocked by the AnimeThemes upstream service.</p>}
          {status.unmatched.length > 0 && <p>{status.unmatched.length} anime could not be matched yet.</p>}
          {canShowControls && <button type="button" onClick={() => void enqueue(mode === 'FULL')} disabled={pendingMode !== null}>Retry sync</button>}
        </section>
      )}

      {canShowControls && status?.state !== 'FAILED' && (
        <div className="sync-page__controls">
          <button type="button" onClick={() => void enqueue(false)} disabled={pendingMode !== null || isWorking}>Sync now</button>
          <button type="button" onClick={() => setShowFullConfirmation(true)} disabled={pendingMode !== null || isWorking}>Re-sync all</button>
        </div>
      )}

      <div className="sync-page__footer">
        <button type="button" onClick={() => void auth.logout().then(() => navigate('/login', { replace: true })).catch(() => navigate('/login', { replace: true }))}>Unlink Kitsu account</button>
      </div>

      {showFullConfirmation && (
        <div className="sync-page__dialog-backdrop">
          <div className="sync-page__dialog" role="dialog" aria-modal="true" aria-labelledby="full-resync-title">
            <h2 id="full-resync-title">Re-sync entire library?</h2>
            <p>This re-imports your complete Kitsu library and refreshes theme matches. Existing library data, play counts, and listening history remain available.</p>
            <div>
              <button type="button" onClick={() => setShowFullConfirmation(false)}>Cancel</button>
              <button type="button" onClick={() => void enqueue(true)}>Re-sync</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function SyncStatusCard({ status, mode }: { status: SyncStatus; mode: SyncMode | null }) {
  const modeLabel = mode === 'FULL' ? 'Full sync' : mode === 'DELTA' ? 'Delta sync' : 'Library sync'
  const phase = status.state === 'DONE' ? 'Sync complete' : status.state === 'FAILED' ? 'Sync failed' : phaseLabel(status.phase)
  const fetched = numberValue(status.progress.fetchedCount)
  const totalCount = numberValue(status.progress.totalCount)
  const processed = numberValue(status.progress.processed)
  const total = numberValue(status.progress.total)
  const mapped = numberValue(status.progress.mapped)
  const countCurrent = fetched ?? processed
  const countTotal = totalCount ?? total
  const percentage = progressPercentage(status, countCurrent, countTotal)

  return (
    <section className="sync-page__status" aria-labelledby="sync-status-title">
      <h2 id="sync-status-title">{modeLabel}</h2>
      <p className="sync-page__phase">{phase}</p>
      <div
        className="sync-page__progress"
        role="progressbar"
        aria-label="Library sync progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="sync-page__count-row">
        <span>{countCurrent !== null && countTotal !== null ? `${countCurrent} of ${countTotal} titles` : progressCopy(status)}</span>
        <strong>{percentage}%</strong>
      </div>
      {mapped !== null && <p className="sync-page__mapped">{mapped} themes matched</p>}
    </section>
  )
}

function progressPercentage(status: SyncStatus, current: number | null, total: number | null): number {
  if (status.state === 'DONE') return 100
  if (status.state === 'IDLE') return 0
  if (current !== null && total !== null && total > 0) return Math.max(1, Math.min(99, Math.round((current / total) * 100)))
  if (status.state === 'QUEUED') return 8
  if (status.phase === 'MAPPING_THEMES') return 72
  if (status.phase === 'REFRESHING_KITSU_TOKEN') return 18
  return 32
}

function progressCopy(status: SyncStatus): string {
  if (status.state === 'DONE') return 'All caught up'
  if (status.state === 'QUEUED') return 'Getting things ready'
  if (status.phase === 'MAPPING_THEMES') return 'Matching music to your shows'
  return 'Reading your Kitsu library'
}

function isActive(state: SyncJobState): boolean {
  return state === 'QUEUED' || state === 'RUNNING'
}

function phaseLabel(phase: string | null): string {
  switch (phase) {
    case 'SYNCING_LIBRARY': return 'Syncing library'
    case 'MAPPING_THEMES': return 'Mapping themes'
    case 'REFRESHING_KITSU_TOKEN': return 'Refreshing Kitsu connection'
    case 'YIELDED': return 'Continuing theme matching'
    case 'SKIPPED': return 'Sync skipped'
    case 'DONE': return 'Sync complete'
    default: return phase ? phase.replaceAll('_', ' ').toLowerCase() : 'Waiting for sync'
  }
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
