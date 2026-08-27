import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { apiClient } from '../../lib/api'
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

type SyncMode = 'FULL' | 'DELTA'

export function SyncPage() {
  const auth = useAuth()
  const navigate = useNavigate()
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
    auth.markInitialSyncReady()
  }, [auth, status])

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
  const isFirstSync = auth.firstSync.status === 'syncing'
  const isWorking = pendingMode !== null || (status !== null && isActive(status.state))
  const canShowControls = !isFirstSync || !isWorking
  const title = status?.state === 'DONE' ? 'Sync complete' : isFirstSync ? 'Syncing your library' : 'Library sync'

  return (
    <section className="sync-page" aria-labelledby="sync-page-title" aria-busy={loading || isWorking}>
      <header className="sync-page__header">
        <p className="sync-page__eyebrow">Kitsu connection</p>
        <h1 id="sync-page-title">{title}</h1>
        <p>{isFirstSync ? 'Keep this page open while Anime Ongaku imports and matches your library.' : 'Keep your Anime Ongaku library current across devices.'}</p>
      </header>

      {loading && <p role="status">Checking sync status…</p>}
      {error && <p className="sync-page__feedback sync-page__feedback--error" role="alert">{error}</p>}

      {status && (
        <SyncStatusCard status={status} mode={mode} />
      )}

      {status?.state === 'FAILED' && (
        <section className="sync-page__notice" aria-labelledby="sync-failure-title">
          <h2 id="sync-failure-title">Sync failed</h2>
          <p>Your existing library data remains available while you retry.</p>
          {status.upstreamBlocked && <p>Theme matching is currently blocked by the AnimeThemes upstream service.</p>}
          {status.unmatched.length > 0 && (
            <div>
              <h3>Unmatched anime</h3>
              <ul>{status.unmatched.map((name) => <li key={name}>{name}</li>)}</ul>
            </div>
          )}
          {canShowControls && <button type="button" onClick={() => void enqueue(mode === 'FULL')} disabled={pendingMode !== null}>Retry sync</button>}
        </section>
      )}

      {canShowControls && status?.state !== 'FAILED' && (
        <div className="sync-page__controls">
          <button type="button" onClick={() => void enqueue(false)} disabled={pendingMode !== null || isWorking}>Sync now</button>
          <button type="button" onClick={() => setShowFullConfirmation(true)} disabled={pendingMode !== null || isWorking}>Re-sync all</button>
        </div>
      )}

      {isFirstSync && isWorking && <p className="sync-page__hint" role="status">The rest of the app will unlock when this first sync is complete.</p>}

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
  const page = numberValue(status.progress.page)
  const totalPages = numberValue(status.progress.totalPages)
  const fetched = numberValue(status.progress.fetchedCount)
  const totalCount = numberValue(status.progress.totalCount)
  const processed = numberValue(status.progress.processed)
  const total = numberValue(status.progress.total)
  const mapped = numberValue(status.progress.mapped)
  const countCurrent = fetched ?? processed
  const countTotal = totalCount ?? total

  return (
    <section className="sync-page__status" aria-labelledby="sync-status-title">
      <h2 id="sync-status-title">{modeLabel}</h2>
      <p>{phase}</p>
      {page !== null && totalPages !== null && <p>Page {page} / {totalPages}</p>}
      {countCurrent !== null && countTotal !== null && <p>{countCurrent} / {countTotal}</p>}
      {mapped !== null && <p>{mapped} mapped themes</p>}
      {status.state === 'QUEUED' && <p>Queued</p>}
    </section>
  )
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
