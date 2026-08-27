import type { PlaybackMode } from '../media/modeSwitch'
import type { QueueEntry, QueueEntryId, QueueItem } from './queue'

export interface QueueThemePreference {
  readonly disliked?: boolean
  readonly dislikedTvSize?: boolean
  readonly dislikedFullSize?: boolean
}

export interface QueueSongPreference {
  readonly disliked?: boolean
}

/**
 * The subset of the synchronized library preferences that can affect automatic
 * browser playback. It intentionally uses maps rather than the full library
 * DTO so the queue remains independent from React Query.
 */
export interface QueuePreferenceSnapshot {
  readonly themesById: Readonly<Record<string, QueueThemePreference | undefined>>
  readonly songsById: Readonly<Record<string, QueueSongPreference | undefined>>
}

export const emptyQueuePreferenceSnapshot: QueuePreferenceSnapshot = {
  themesById: {},
  songsById: {},
}

interface PreferenceAwareQueueItem extends QueueItem {
  readonly itemType?: 'THEME' | 'SONG'
  readonly themeId?: number
  readonly songId?: number
  readonly mode?: PlaybackMode
}

/**
 * Mirrors Android's preference eligibility contract. An unskip applies to the
 * queue occurrence, never all copies of a theme or song.
 */
export function isQueueEntryAllowedByPreference(
  entry: QueueEntry,
  preferences: QueuePreferenceSnapshot,
  unskippedEntryIds: ReadonlySet<QueueEntryId> = new Set(),
  actualMode?: PlaybackMode,
): boolean {
  if (unskippedEntryIds.has(entry.queueId)) return true
  return isQueueItemAllowedByPreference(entry.item, preferences, actualMode)
}

export function isQueueItemAllowedByPreference(
  item: QueueItem,
  preferences: QueuePreferenceSnapshot,
  actualMode?: PlaybackMode,
): boolean {
  const candidate = item as PreferenceAwareQueueItem
  if (candidate.itemType === 'SONG') {
    const songId = candidate.songId
    return !Number.isInteger(songId) || !preferences.songsById[String(songId)]?.disliked
  }
  if (candidate.itemType !== 'THEME') return true

  const themeId = candidate.themeId
  if (!Number.isInteger(themeId)) return true
  const preference = preferences.themesById[String(themeId)]
  if (!preference || preference.disliked) return !preference?.disliked
  const mode = actualMode ?? candidate.mode
  if (mode === 'TV_SIZE') return !preference.dislikedTvSize
  if (mode === 'FULL_SIZE') return !preference.dislikedFullSize
  return true
}

/** Returns the playback projection of the logical queue, without mutating it. */
export function filterQueueEntriesForPlayback(
  entries: readonly QueueEntry[],
  preferences: QueuePreferenceSnapshot,
  unskippedEntryIds: ReadonlySet<QueueEntryId> = new Set(),
): QueueEntry[] {
  return entries.filter((entry) => isQueueEntryAllowedByPreference(entry, preferences, unskippedEntryIds))
}

/**
 * Finds the current item in a filtered playback projection. If it became
 * ineligible, advance forward in the source order just as Android does.
 */
export function desiredCurrentQueueIndex(
  originalEntries: readonly QueueEntry[],
  currentQueueId: QueueEntryId | undefined,
  resolvedQueueIds: readonly QueueEntryId[],
): number | null {
  if (currentQueueId === undefined) return resolvedQueueIds.length > 0 ? 0 : null
  const currentResolvedIndex = resolvedQueueIds.indexOf(currentQueueId)
  if (currentResolvedIndex >= 0) return currentResolvedIndex

  const sourceIndex = originalEntries.findIndex((entry) => entry.queueId === currentQueueId)
  if (sourceIndex >= 0) {
    for (const entry of originalEntries.slice(sourceIndex + 1)) {
      const resolvedIndex = resolvedQueueIds.indexOf(entry.queueId)
      if (resolvedIndex >= 0) return resolvedIndex
    }
  }
  return null
}

/** Selects the next eligible logical queue entry while preserving repeat semantics. */
export function nextEligibleQueueIndex(
  entries: readonly QueueEntry[],
  currentIndex: number,
  repeatMode: 'off' | 'all' | 'one',
  preferences: QueuePreferenceSnapshot,
  unskippedEntryIds: ReadonlySet<QueueEntryId> = new Set(),
): number | null {
  if (entries.length === 0 || currentIndex < 0 || currentIndex >= entries.length) return null

  const current = entries[currentIndex]
  if (repeatMode === 'one' && current && isQueueEntryAllowedByPreference(current, preferences, unskippedEntryIds)) {
    return currentIndex
  }

  for (let offset = 1; offset <= entries.length; offset += 1) {
    const index = currentIndex + offset
    if (index >= entries.length && repeatMode !== 'all') return null
    const candidateIndex = index % entries.length
    const candidate = entries[candidateIndex]
    if (candidate && isQueueEntryAllowedByPreference(candidate, preferences, unskippedEntryIds)) return candidateIndex
  }
  return null
}
