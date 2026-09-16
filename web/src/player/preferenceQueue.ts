import type { PlaybackMode } from '../media/modeSwitch'
import { queueItemAudioUrl, queueItemVideoUrl, type PlayerQueueItem } from './mapping'
import type { QueueEntry, QueueEntryId, QueueItem } from './queue'
import { resolveQueueMode, type QueueModePolicyResult } from '../../../shared/queueModePolicy'

export interface QueueThemePreference {
  readonly disliked?: boolean
  readonly dislikedTvSize?: boolean
  readonly dislikedFullSize?: boolean
  readonly preferredMode?: 'TV_SIZE' | 'FULL_SIZE' | null
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
  readonly softMode?: 'TV_SIZE' | 'FULL_SIZE'
  readonly requiredMode?: PlaybackMode
}

export interface QueueModeResolutionOptions {
  readonly softMode?: 'TV_SIZE' | 'FULL_SIZE' | null
  readonly allowDisliked?: boolean
  readonly queueDesiredMode?: PlaybackMode
  readonly replayMode?: PlaybackMode
}

export function queueEntryDislikeFingerprint(
  entry: QueueEntry,
  preferences: QueuePreferenceSnapshot,
  mode: PlaybackMode | undefined = entry.lastActualMode,
): string {
  const candidate = entry.item as PreferenceAwareQueueItem
  if (candidate.itemType === 'SONG') {
    return preferences.songsById[String(candidate.songId)]?.disliked === true ? 'song:1' : 'song:0'
  }
  if (candidate.itemType !== 'THEME') return 'none'
  const preference = preferences.themesById[String(candidate.themeId)]
  const variantDisliked = mode === 'TV_SIZE'
    ? preference?.dislikedTvSize === true
    : mode === 'FULL_SIZE'
      ? preference?.dislikedFullSize === true
      : false
  return `theme:${preference?.disliked === true ? 1 : 0}:${variantDisliked ? 1 : 0}`
}

/**
 * Returns whether a persisted occurrence exception is invalidated by the
 * synchronized dislike state. This deliberately checks the occurrence's last
 * actual variant so a Full-size preference change cannot revoke a TV-size
 * exception (and vice versa).
 */
export function isQueueEntryUnskipInvalid(
  entry: QueueEntry,
  preferences: QueuePreferenceSnapshot,
): boolean {
  const candidate = entry.item as PreferenceAwareQueueItem
  if (candidate.itemType === 'SONG') {
    return preferences.songsById[String(candidate.songId)]?.disliked === true
  }
  if (candidate.itemType !== 'THEME') return false
  const preference = preferences.themesById[String(candidate.themeId)]
  if (!preference) return false
  if (preference.disliked === true) return true
  const mode = entry.lastActualMode ?? candidate.mode
  return mode === 'TV_SIZE'
    ? preference.dislikedTvSize === true
    : mode === 'FULL_SIZE'
      ? preference.dislikedFullSize === true
      : false
}

export function resolveQueueItemPolicy(
  item: QueueItem,
  preferences: QueuePreferenceSnapshot,
  queueDesiredMode: PlaybackMode = 'TV_SIZE',
  manualMode?: PlaybackMode,
  options: QueueModeResolutionOptions = {},
): QueueModePolicyResult {
  const candidate = item as PreferenceAwareQueueItem
  if (candidate.itemType !== 'THEME' && candidate.itemType !== 'SONG') {
    const selected = manualMode ?? options.replayMode ?? queueDesiredMode
    return { desiredMode: selected, actualMode: selected, reason: 'SELECTED' }
  }
  if (candidate.itemType === 'SONG') {
    const available = Boolean(queueItemAudioUrl(item, 'FULL_SIZE'))
    const allowDisliked = options.allowDisliked === true || manualMode != null
    const disliked = preferences.songsById[String(candidate.songId)]?.disliked === true
    return {
      desiredMode: queueDesiredMode,
      actualMode: available && (allowDisliked || !disliked) ? 'FULL_SIZE' : null,
      reason: available && (allowDisliked || !disliked) ? 'SELECTED' : 'NO_ALLOWED_MODE',
    }
  }
  const preference = candidate.itemType === 'THEME' ? preferences.themesById[String(candidate.themeId)] : undefined
  const available = {
    TV_SIZE: Boolean(queueItemAudioUrl(item, 'TV_SIZE')),
    FULL_SIZE: Boolean(queueItemAudioUrl(item, 'FULL_SIZE')),
    VIDEO: Boolean(queueItemVideoUrl(item)),
  }
  const requiredAudioMode = candidate.requiredMode === 'TV_SIZE' || candidate.requiredMode === 'FULL_SIZE'
    ? candidate.requiredMode
    : undefined
  const baseInput = {
    queueDesiredMode,
    savedPreferredAudioMode: preference?.preferredMode,
    softMode: Object.prototype.hasOwnProperty.call(options, 'softMode')
      ? options.softMode
      : candidate.softMode ?? (candidate.mode === 'TV_SIZE' || candidate.mode === 'FULL_SIZE' ? candidate.mode : undefined),
    requiredAudioMode,
    manualMode,
    globallyDisliked: preference?.disliked,
    dislikedTvSize: preference?.dislikedTvSize,
    dislikedFullSize: preference?.dislikedFullSize,
    allowDisliked: options.allowDisliked,
    available,
  }
  const replayMode = options.replayMode
  if (replayMode) {
    const replayDisliked = preference?.disliked === true
      || (replayMode === 'TV_SIZE' && preference?.dislikedTvSize === true)
      || (replayMode === 'FULL_SIZE' && preference?.dislikedFullSize === true)
    if (options.allowDisliked || !replayDisliked) {
      const exact = resolveQueueMode({ ...baseInput, savedPreferredAudioMode: undefined, softMode: undefined, queueDesiredMode: replayMode, manualMode: replayMode })
      if (exact.actualMode != null) return exact
      return resolveQueueMode({ ...baseInput, savedPreferredAudioMode: undefined, softMode: undefined, queueDesiredMode: replayMode })
    }
  }
  return resolveQueueMode({ ...baseInput, manualMode })
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
  queueDesiredMode: PlaybackMode = 'TV_SIZE',
): boolean {
  const allowDisliked = entry.unskipped === true || unskippedEntryIds.has(entry.queueId)
  if (actualMode !== undefined) {
    if (!allowDisliked) return isQueueItemAllowedByPreference(entry.item, preferences, actualMode, queueDesiredMode)
    return resolveQueueItemPolicy(entry.item, preferences, queueDesiredMode, actualMode, { allowDisliked: true }).actualMode === actualMode
  }
  return resolveQueueItemPolicy(entry.item, preferences, queueDesiredMode, entry.manualMode, {
    allowDisliked,
    replayMode: entry.replayRequested ? entry.lastActualMode : undefined,
  }).actualMode !== null
}

export function isQueueItemAllowedByPreference(
  item: QueueItem,
  preferences: QueuePreferenceSnapshot,
  actualMode?: PlaybackMode,
  queueDesiredMode: PlaybackMode = 'TV_SIZE',
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
  if (actualMode === undefined && ('tvAudioUrl' in item || 'fullAudioUrl' in item)) {
    return resolveQueueItemPolicy(item, preferences, queueDesiredMode).actualMode !== null
  }
  const mode = actualMode ?? candidate.mode
  const required = (item as PlayerQueueItem).requiredMode
  if (required && mode !== required && mode !== 'VIDEO') return false
  if (required && mode === 'VIDEO' && !queueItemAudioUrl(item, required)) return false
  if (!preference || preference.disliked) return !preference?.disliked
  if (mode === 'TV_SIZE') return !preference.dislikedTvSize
  if (mode === 'FULL_SIZE') return !preference.dislikedFullSize
  return true
}

/** Shared selection for queue eligibility and the media element. Never load a rejected size. */
export function resolveQueueItemMode(item: QueueItem, preferences: QueuePreferenceSnapshot, fallback: PlaybackMode, manualMode?: PlaybackMode): PlaybackMode | null {
  return resolveQueueItemPolicy(item, preferences, fallback, manualMode).actualMode
}

/** Returns the playback projection of the logical queue, without mutating it. */
export function filterQueueEntriesForPlayback(
  entries: readonly QueueEntry[],
  preferences: QueuePreferenceSnapshot,
  unskippedEntryIds: ReadonlySet<QueueEntryId> = new Set(),
  queueDesiredMode: PlaybackMode = 'TV_SIZE',
): QueueEntry[] {
  return entries.filter((entry) => isQueueEntryAllowedByPreference(entry, preferences, unskippedEntryIds, undefined, queueDesiredMode))
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
  queueDesiredMode: PlaybackMode = 'TV_SIZE',
): number | null {
  if (entries.length === 0 || currentIndex < 0 || currentIndex >= entries.length) return null

  const current = entries[currentIndex]
  if (repeatMode === 'one' && current && isQueueEntryAllowedByPreference(current, preferences, unskippedEntryIds, undefined, queueDesiredMode)) {
    return currentIndex
  }

  for (let offset = 1; offset <= entries.length; offset += 1) {
    const index = currentIndex + offset
    if (index >= entries.length && repeatMode !== 'all') return null
    const candidateIndex = index % entries.length
    const candidate = entries[candidateIndex]
    if (candidate && isQueueEntryAllowedByPreference(candidate, preferences, unskippedEntryIds, undefined, queueDesiredMode)) return candidateIndex
  }
  return null
}
