import type { QueueEntry, QueueItem, QueueState, RepeatMode } from './queue'

export const QUEUE_PERSISTENCE_VERSION = 1

const STORAGE_PREFIX = `anime-ongaku:queue:v${QUEUE_PERSISTENCE_VERSION}:`
const MAX_SNAPSHOT_BYTES = 512_000
const MAX_QUEUE_ENTRIES = 1_000

interface PersistedQueue {
  version: number
  queue: QueueState
}

export function queuePersistenceKey(kitsuUserId: string): string {
  return `${STORAGE_PREFIX}${kitsuUserId}`
}

export function loadPersistedQueue(kitsuUserId: string): QueueState | undefined {
  const storage = browserStorage()
  if (!storage || !isKitsuUserId(kitsuUserId)) return undefined
  try {
    const raw = storage.getItem(queuePersistenceKey(kitsuUserId))
    if (!raw || raw.length > MAX_SNAPSHOT_BYTES) return undefined
    const parsed: unknown = JSON.parse(raw)
    return isPersistedQueue(parsed) ? parsed.queue : undefined
  } catch {
    return undefined
  }
}

export function savePersistedQueue(kitsuUserId: string, queue: QueueState): void {
  const storage = browserStorage()
  if (!storage || !isKitsuUserId(kitsuUserId) || !isQueueState(queue)) return
  try {
    const serialized = JSON.stringify({ version: QUEUE_PERSISTENCE_VERSION, queue } satisfies PersistedQueue)
    if (serialized.length > MAX_SNAPSHOT_BYTES) return
    storage.setItem(queuePersistenceKey(kitsuUserId), serialized)
  } catch {
    // Storage can be unavailable or full. Playback must remain usable either way.
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function isPersistedQueue(value: unknown): value is PersistedQueue {
  return isRecord(value)
    && value.version === QUEUE_PERSISTENCE_VERSION
    && isQueueState(value.queue)
}

function isQueueState(value: unknown): value is QueueState {
  if (!isRecord(value)
    || !isEntryArray(value.originalQueueEntries)
    || !isEntryArray(value.nowPlayingEntries)
    || !isEntryArray(value.historyEntries)
    || !isIdArray(value.playNextEntryIds)
    || !isIdArray(value.addedToQueueEntryIds)
    || !isIdArray(value.suggestedEntryIds)
    || !isIdArray(value.playedEntryIds)
    || !isIdArray(value.unskippedEntryIds)
    || !isNonNegativeInteger(value.currentIndex)
    || !isNonNegativeInteger(value.nextQueueEntryId)
    || !isNonNegativeInteger(value.queueVersion)
    || !isNonNegativeInteger(value.playRequestGeneration)
    || typeof value.contextLabel !== 'string'
    || typeof value.isShuffled !== 'boolean'
    || !isRepeatMode(value.repeatMode)) return false

  const entryCount = value.originalQueueEntries.length + value.nowPlayingEntries.length + value.historyEntries.length
  return entryCount <= MAX_QUEUE_ENTRIES
}

function isEntryArray(value: unknown): value is readonly QueueEntry[] {
  return Array.isArray(value) && value.length <= MAX_QUEUE_ENTRIES && value.every(isQueueEntry)
}

function isQueueEntry(value: unknown): value is QueueEntry {
  return isRecord(value) && isPositiveInteger(value.queueId) && isQueueItem(value.item)
}

function isQueueItem(value: unknown): value is QueueItem {
  return isRecord(value) && (typeof value.id === 'string' || typeof value.id === 'number')
}

function isIdArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length <= MAX_QUEUE_ENTRIES && value.every(isPositiveInteger)
}

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === 'off' || value === 'all' || value === 'one'
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isKitsuUserId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
