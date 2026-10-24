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
  libraryState?: SyncJobState
  libraryLastCompletedAt?: number | null
  stages?: Partial<Record<SyncStageName, SyncStageStatus>>
}

type SyncStageName = 'library' | 'catalog' | 'playlists' | 'musicPolicy'

interface SyncStageStatus {
  state: SyncJobState
  counts: Record<string, number>
  updatedAt: number | null
  lastCompletedAt: number | null
  nextRetryAt: number | null
  lastError: string | null
  failedJobIds: number[]
  attentionCount: number
  truncated: boolean
}

const stageLabels: Record<SyncStageName, string> = {
  library: 'Kitsu library import',
  catalog: 'Theme catalog matching',
  playlists: 'Automatic playlists',
  musicPolicy: 'Music search eligibility',
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
  const [retryingStage, setRetryingStage] = useState<SyncStageName | null>(null)
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
    if (!status || !(isActive(status.state) || Object.values(status.stages ?? {}).some((stage) =>
      stage && (isActive(stage.state) || (stage.counts.RUNNING ?? 0) > 0 || (stage.counts.QUEUED ?? 0) > 0),
    ))) return undefined
    const timer = window.setInterval(() => {
      void readStatus().catch(() => {
        setError('We could not refresh sync progress. We will keep trying.')
      })
    }, SYNC_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [readStatus, status])

  useEffect(() => {
    if (!status || (status.libraryState ?? status.state) !== 'DONE' || auth.firstSync.status !== 'syncing' || completionHandled.current) return
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

  const retryStage = async (stage: SyncStageName) => {
    setRetryingStage(stage)
    setError(null)
    try {
      await apiClient.post(`/v1/sync/stages/${stage}/retry`, {})
      await readStatus()
    } catch {
      setError(`We could not retry ${stageLabels[stage].toLowerCase()}. Try again in a moment.`)
    } finally {
      setRetryingStage(null)
    }
  }

  const mode = modeRef.current ?? auth.firstSync.mode ?? null
  const libraryState = status?.libraryState ?? status?.state
  const libraryStatus = status && status.libraryState ? { ...status, state: status.libraryState, phase: status.libraryState === 'DONE' ? 'DONE' : status.phase } : status
  const isFirstSync = auth.firstSync.status === 'syncing' && auth.firstSync.isNewUser
  const isWorking = pendingMode !== null || (libraryState !== undefined && isActive(libraryState))
  const canShowControls = !isFirstSync || !isWorking
  const title = libraryState === 'DONE' ? 'Sync complete — your library is ready' : isFirstSync ? 'Syncing your library' : 'Library sync'

  return (
    <section className="sync-page" aria-labelledby="sync-page-title" aria-busy={loading || isWorking}>
      <div className="sync-page__hero">
        <img className="sync-page__art" src={librarySyncIllustration} alt="" aria-hidden="true" />
        <div className="sync-page__hero-copy">
          <header className="sync-page__header">
            <p className="sync-page__eyebrow">Kitsu connection</p>
            <h1 id="sync-page-title">{title}</h1>
            <p>{isFirstSync ? 'We are bringing over your shows. Music matching continues in the background after your library opens.' : 'Keep your Anime Ongaku library current across devices.'}</p>
          </header>

          {loading && <p role="status">Checking sync status…</p>}
          {libraryStatus && <SyncStatusCard status={libraryStatus} mode={mode} />}
          {isFirstSync && isWorking && <p className="sync-page__hint" role="status">This usually only takes a moment. Your library will open automatically.</p>}
        </div>
      </div>

      {error && <p className="sync-page__feedback sync-page__feedback--error" role="alert">{error}</p>}

      {libraryState === 'FAILED' && status && (
        <section className="sync-page__notice" aria-labelledby="sync-failure-title">
          <h2 id="sync-failure-title">Sync failed</h2>
          <p>Your existing library data remains available while you retry.</p>
          {status.upstreamBlocked && <p>Theme matching is currently blocked by the AnimeThemes upstream service.</p>}
          {status.unmatched.length > 0 && <p>{status.unmatched.length} anime could not be matched yet.</p>}
          {canShowControls && <button type="button" onClick={() => void enqueue(mode === 'FULL')} disabled={pendingMode !== null}>Retry sync</button>}
        </section>
      )}

      {status?.stages && (
        <section className="sync-page__stages" aria-labelledby="sync-stages-title">
          <h2 id="sync-stages-title">Background progress</h2>
          <p>Library imports, theme matching, playlists, and music search recover independently. Music downloads and items awaiting review appear in Music requests.</p>
          {(Object.entries(status.stages) as [SyncStageName, SyncStageStatus][]).map(([name, stage]) => (
            <section className="sync-page__status" key={name} aria-label={stageLabels[name]}>
              <h3>{stageLabels[name]}</h3>
              <p>{name === 'musicPolicy' && stage.state === 'DONE' ? 'Automatic music checks queued or completed' : stageStateLabel(stage)}</p>
              {stage.updatedAt !== null && <p>Updated <time dateTime={new Date(stage.updatedAt).toISOString()}>{new Date(stage.updatedAt).toLocaleString()}</time></p>}
              {stage.nextRetryAt !== null && <p>Automatic retry scheduled for {new Date(stage.nextRetryAt).toLocaleString()}.</p>}
              {stage.lastError && <p className="sync-page__feedback--error">{stage.lastError}</p>}
              {stage.attentionCount > 0 && <p>{stage.attentionCount} catalog items have no matching metadata yet. They can be checked again with Re-sync all.</p>}
              {stage.truncated && <p>Showing recent retained jobs; older work may not appear here.</p>}
              {stage.failedJobIds.length > 0 && <button type="button" disabled={retryingStage !== null} onClick={() => void retryStage(name)}>Retry {stageLabels[name].toLowerCase()}</button>}
            </section>
          ))}
        </section>
      )}

      {canShowControls && libraryState !== 'FAILED' && (
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
        aria-valuenow={percentage ?? undefined}
        aria-valuetext={percentage === null ? phase : undefined}
      >
        <span style={{ width: percentage === null ? '25%' : `${percentage}%` }} />
      </div>
      <div className="sync-page__count-row">
        <span>{countCurrent !== null && countTotal !== null ? `${countCurrent} of ${countTotal} titles` : progressCopy(status)}</span>
        {percentage !== null && <strong>{percentage}%</strong>}
      </div>
      {mapped !== null && <p className="sync-page__mapped">{mapped} themes matched</p>}
      {status.libraryLastCompletedAt != null && <p>Last Kitsu import: <time dateTime={new Date(status.libraryLastCompletedAt).toISOString()}>{new Date(status.libraryLastCompletedAt).toLocaleString()}</time></p>}
    </section>
  )
}

function progressPercentage(status: SyncStatus, current: number | null, total: number | null): number | null {
  if (status.state === 'DONE') return 100
  if (status.state === 'IDLE') return 0
  if (current !== null && total !== null && total > 0) return Math.max(1, Math.min(99, Math.round((current / total) * 100)))
  return null
}

function progressCopy(status: SyncStatus): string {
  if (status.state === 'DONE') return status.libraryState ? 'Kitsu library updated' : 'All caught up'
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

function stageStateLabel(stage: SyncStageStatus): string {
  const counts = stage.counts
  if (stage.state === 'IDLE') return 'No updates yet'
  return [
    counts.RUNNING ? `${counts.RUNNING} running` : null,
    counts.QUEUED ? `${counts.QUEUED} queued` : null,
    counts.FAILED ? `${counts.FAILED} failed` : null,
    counts.DONE ? `${counts.DONE} complete` : null,
    counts.SKIPPED ? `${counts.SKIPPED} skipped` : null,
  ].filter(Boolean).join(' · ')
}
