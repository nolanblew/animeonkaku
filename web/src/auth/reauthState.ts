import type { PlaybackMode } from '../media/modeSwitch'
import type { QueueEntry, QueueState } from '../player/queue'

export const DEFAULT_REAUTH_MAX_AGE_MS = 15 * 60 * 1_000

export interface ReauthenticationStateInput {
  route: string
  queueState: QueueState
  currentTimeSeconds: number
  mode: PlaybackMode
  capturedAtMs: number
}

export interface ReauthenticationState {
  readonly route: string
  readonly queueState: QueueState
  readonly currentTimeSeconds: number
  readonly mode: PlaybackMode
  readonly capturedAtMs: number
}

export interface RestoreReauthenticationOptions {
  nowMs: number
  maxAgeMs?: number
}

/**
 * Creates a reconnect snapshot from browser-owned state only. Auth cookies,
 * passwords, and bearer/session material are deliberately not part of this
 * shape so it is safe to keep briefly in memory or session storage.
 */
export function captureReauthenticationState(input: ReauthenticationStateInput): ReauthenticationState {
  return {
    route: safeRoute(input.route),
    queueState: cloneQueueState(input.queueState),
    currentTimeSeconds: finiteNonNegative(input.currentTimeSeconds),
    mode: input.mode,
    capturedAtMs: finiteTimestamp(input.capturedAtMs),
  }
}

/** Returns a defensive reconnect snapshot while it is still fresh. */
export function restoreReauthenticationState(
  snapshot: ReauthenticationState | null | undefined,
  options: RestoreReauthenticationOptions,
): ReauthenticationState | undefined {
  if (!isReauthenticationState(snapshot)) return undefined
  const nowMs = finiteTimestamp(options.nowMs)
  const maxAgeMs = Number.isFinite(options.maxAgeMs) && (options.maxAgeMs ?? 0) >= 0
    ? options.maxAgeMs!
    : DEFAULT_REAUTH_MAX_AGE_MS
  const ageMs = nowMs - snapshot.capturedAtMs
  if (ageMs < 0 || ageMs > maxAgeMs) return undefined
  return captureReauthenticationState(snapshot)
}

function isReauthenticationState(value: unknown): value is ReauthenticationState {
  if (!isRecord(value)) return false
  return typeof value.route === 'string'
    && isQueueState(value.queueState)
    && typeof value.currentTimeSeconds === 'number'
    && Number.isFinite(value.currentTimeSeconds)
    && value.currentTimeSeconds >= 0
    && (value.mode === 'TV_SIZE' || value.mode === 'FULL_SIZE' || value.mode === 'VIDEO')
    && typeof value.capturedAtMs === 'number'
    && Number.isFinite(value.capturedAtMs)
}

function cloneQueueState(state: QueueState): QueueState {
  return {
    ...state,
    originalQueueEntries: state.originalQueueEntries.map(cloneQueueEntry),
    nowPlayingEntries: state.nowPlayingEntries.map(cloneQueueEntry),
    historyEntries: state.historyEntries.map(cloneQueueEntry),
    playNextEntryIds: [...state.playNextEntryIds],
    addedToQueueEntryIds: [...state.addedToQueueEntryIds],
    suggestedEntryIds: [...state.suggestedEntryIds],
    playedEntryIds: [...state.playedEntryIds],
    unskippedEntryIds: [...state.unskippedEntryIds],
  }
}

function cloneQueueEntry(entry: QueueEntry): QueueEntry {
  return { queueId: entry.queueId, item: { ...entry.item } }
}

function isQueueState(value: unknown): value is QueueState {
  if (!isRecord(value)) return false
  return Array.isArray(value.originalQueueEntries)
    && Array.isArray(value.nowPlayingEntries)
    && Array.isArray(value.historyEntries)
    && Array.isArray(value.playNextEntryIds)
    && Array.isArray(value.addedToQueueEntryIds)
    && Array.isArray(value.suggestedEntryIds)
    && Array.isArray(value.playedEntryIds)
    && Array.isArray(value.unskippedEntryIds)
    && typeof value.currentIndex === 'number'
    && typeof value.nextQueueEntryId === 'number'
    && typeof value.queueVersion === 'number'
    && typeof value.playRequestGeneration === 'number'
    && typeof value.contextLabel === 'string'
    && typeof value.isShuffled === 'boolean'
    && (value.repeatMode === 'off' || value.repeatMode === 'all' || value.repeatMode === 'one')
    && value.originalQueueEntries.every(isQueueEntry)
    && value.nowPlayingEntries.every(isQueueEntry)
    && value.historyEntries.every(isQueueEntry)
}

function isQueueEntry(value: unknown): value is QueueEntry {
  return isRecord(value)
    && typeof value.queueId === 'number'
    && Number.isSafeInteger(value.queueId)
    && value.queueId > 0
    && isRecord(value.item)
    && (typeof value.item.id === 'string' || typeof value.item.id === 'number')
    && typeof value.item.title === 'string'
}

function safeRoute(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('/') && !trimmed.startsWith('//') ? trimmed : '/'
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function finiteTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
