/**
 * Browser playback queue domain.
 *
 * Queue entries deliberately have an identity separate from the media item id.
 * The same song can therefore be present in a context queue, Play Next, and a
 * manually appended queue without one occurrence stealing another occurrence's
 * history or playback position.
 */

import {
  emptyQueuePreferenceSnapshot,
  isQueueEntryAllowedByPreference,
  queueEntryDislikeFingerprint,
  nextEligibleQueueIndex,
  type QueuePreferenceSnapshot,
} from './preferenceQueue'
import type { PlaybackMode } from '../media/modeSwitch'

export type QueueItemId = number | string
export type QueueEntryId = number
export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueItem {
  readonly id: QueueItemId
  readonly title: string
  readonly artist?: string
  readonly album?: string
  readonly animeId?: QueueItemId
  readonly durationMs?: number
  readonly artworkUrl?: string
  readonly audioUrl?: string
  readonly videoUrl?: string
  readonly [key: string]: unknown
}

export interface QueueEntry {
  readonly queueId: QueueEntryId
  readonly item: QueueItem
  /** Last resolved playback type for this queue occurrence. */
  readonly lastActualMode?: PlaybackMode
  /** Current occurrence-only manual selection. */
  readonly manualMode?: PlaybackMode
  /** One-shot request to replay [lastActualMode] on Back/repeat. */
  readonly replayRequested?: boolean
  /** Explicit per-occurrence dislike override, independent of duplicate copies. */
  readonly unskipped?: boolean
  /** Dislike state when the manual/unskip exception was granted. */
  readonly preferenceBaseline?: string
}

export interface QueueState {
  readonly originalQueueEntries: readonly QueueEntry[]
  readonly nowPlayingEntries: readonly QueueEntry[]
  readonly currentIndex: number
  readonly historyEntries: readonly QueueEntry[]
  readonly playNextEntryIds: readonly QueueEntryId[]
  readonly addedToQueueEntryIds: readonly QueueEntryId[]
  readonly suggestedEntryIds: readonly QueueEntryId[]
  readonly playedEntryIds: readonly QueueEntryId[]
  readonly isShuffled: boolean
  readonly contextLabel: string
  readonly queueVersion: number
  readonly playRequestGeneration: number
  readonly repeatMode: RepeatMode
  /** Explicit, queue-occurrence overrides for a disliked item in this session. */
  readonly unskippedEntryIds: readonly QueueEntryId[]
  /** Internal monotonic allocator. It is persisted in the snapshot so restores cannot reuse ids. */
  readonly nextQueueEntryId: QueueEntryId
  /** Device-local intent for this queue. It is reset when a new context replaces it. */
  readonly desiredMode?: PlaybackMode
}

export interface PlayOptions {
  readonly contextLabel?: string
  readonly startIndex?: number
  readonly shuffle?: boolean
  readonly suggestedFrom?: number
  /** Injectable for deterministic tests and a future seeded queue preference. */
  readonly random?: () => number
  /** Device-local desired mode for the replacement queue. */
  readonly desiredMode?: PlaybackMode
}

export interface QueueStoreOptions {
  readonly random?: () => number
}

export type QueueAction =
  | ({ readonly type: 'play'; readonly items: readonly QueueItem[] } & PlayOptions)
  | { readonly type: 'playNext'; readonly items: readonly QueueItem[] }
  | { readonly type: 'addToQueue'; readonly items: readonly QueueItem[] }
  | { readonly type: 'trackChangedByEntryId'; readonly queueId: QueueEntryId }
  | { readonly type: 'trackChangedByItemId'; readonly itemId: QueueItemId }
  | { readonly type: 'skipTo'; readonly index: number }
  | { readonly type: 'advanceTo'; readonly index: number }
  | { readonly type: 'moveEntry'; readonly fromQueueId: QueueEntryId; readonly toQueueId: QueueEntryId }
  | { readonly type: 'removeEntry'; readonly queueId: QueueEntryId }
  | { readonly type: 'moveToPlayNext'; readonly queueId: QueueEntryId }
  | { readonly type: 'rewindTo'; readonly historyIndex: number }
  | { readonly type: 'setShuffled'; readonly shuffled: boolean; readonly random?: () => number }
  | { readonly type: 'toggleShuffle'; readonly random?: () => number }
  | { readonly type: 'setRepeatMode'; readonly mode: RepeatMode }
  | { readonly type: 'cycleRepeatMode' }
  | { readonly type: 'unskipEntry'; readonly queueId: QueueEntryId; readonly preferenceBaseline?: string }
  | { readonly type: 'selectMode'; readonly queueId: QueueEntryId; readonly mode: PlaybackMode; readonly preferenceBaseline: string }
  | { readonly type: 'requestReplay'; readonly queueId: QueueEntryId; readonly explicit: boolean; readonly preferenceBaseline?: string }
  | { readonly type: 'recordActualMode'; readonly queueId: QueueEntryId; readonly mode: PlaybackMode }
  | { readonly type: 'setDesiredMode'; readonly mode?: PlaybackMode; readonly clearSoftModes?: boolean }
  | { readonly type: 'invalidatePreferenceOverrides'; readonly queueIds: readonly QueueEntryId[] }
  | { readonly type: 'applySavedPreferenceChanges'; readonly themeIds: readonly string[] }
  | { readonly type: 'clear' }
  | { readonly type: 'restore'; readonly state: QueueState }

const emptyEntries: readonly QueueEntry[] = []
const emptyEntryIds: readonly QueueEntryId[] = []

export function createInitialQueueState(): QueueState {
  return {
    originalQueueEntries: emptyEntries,
    nowPlayingEntries: emptyEntries,
    currentIndex: 0,
    historyEntries: emptyEntries,
    playNextEntryIds: emptyEntryIds,
    addedToQueueEntryIds: emptyEntryIds,
    suggestedEntryIds: emptyEntryIds,
    playedEntryIds: emptyEntryIds,
    isShuffled: false,
    contextLabel: '',
    queueVersion: 0,
    playRequestGeneration: 0,
    repeatMode: 'off',
    unskippedEntryIds: emptyEntryIds,
    nextQueueEntryId: 1,
    desiredMode: undefined,
  }
}

export function currentQueueEntry(state: QueueState): QueueEntry | undefined {
  return state.nowPlayingEntries[state.currentIndex]
}

export function upcomingQueueEntries(state: QueueState): readonly QueueEntry[] {
  return state.currentIndex + 1 < state.nowPlayingEntries.length
    ? state.nowPlayingEntries.slice(state.currentIndex + 1)
    : emptyEntries
}

export function entriesForIds(state: QueueState, ids: readonly QueueEntryId[]): readonly QueueEntry[] {
  const entries = new Map<QueueEntryId, QueueEntry>()
  for (const entry of [...state.originalQueueEntries, ...state.nowPlayingEntries, ...state.historyEntries]) {
    entries.set(entry.queueId, entry)
  }
  return ids.flatMap((id) => {
    const entry = entries.get(id)
    return entry ? [entry] : []
  })
}

/** Returns the natural next index without changing state. */
export function nextQueueIndex(state: QueueState, mode = state.repeatMode): number | null {
  if (state.nowPlayingEntries.length === 0) return null
  if (mode === 'one') return state.currentIndex
  if (state.currentIndex + 1 < state.nowPlayingEntries.length) return state.currentIndex + 1
  return mode === 'all' ? 0 : null
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'play':
      return playContext(state, action)
    case 'playNext':
      return insertAfterCurrent(state, action.items, true)
    case 'addToQueue':
      return appendToQueue(state, action.items)
    case 'trackChangedByEntryId': {
      const nextIndex = state.nowPlayingEntries.findIndex((entry) => entry.queueId === action.queueId)
      return nextIndex < 0 ? state : transitionToIndex(state, nextIndex, false, false)
    }
    case 'trackChangedByItemId':
      return transitionToItemId(state, action.itemId)
    case 'skipTo': {
      if (!isValidIndex(state, action.index)) return state
      const transitioned = transitionToIndex(state, action.index, true, true)
      const skippedIds = action.index > state.currentIndex
        ? state.nowPlayingEntries.slice(state.currentIndex, action.index + 1).map((entry) => entry.queueId)
        : [state.nowPlayingEntries[action.index].queueId]
      return {
        ...transitioned,
        playedEntryIds: appendUniqueIds(transitioned.playedEntryIds, skippedIds),
      }
    }
    case 'advanceTo':
      return isValidIndex(state, action.index)
        ? transitionToIndex(state, action.index, false, false)
        : state
    case 'moveEntry':
      return moveEntry(state, action.fromQueueId, action.toQueueId)
    case 'removeEntry':
      return removeEntry(state, action.queueId)
    case 'moveToPlayNext':
      return moveToPlayNext(state, action.queueId)
    case 'rewindTo':
      return rewindTo(state, action.historyIndex)
    case 'setShuffled':
      return action.shuffled === state.isShuffled
        ? state
        : action.shuffled
          ? shuffle(state, action.random)
          : unshuffle(state)
    case 'toggleShuffle':
      return state.isShuffled ? unshuffle(state) : shuffle(state, action.random)
    case 'setRepeatMode':
      return action.mode === state.repeatMode
        ? state
        : { ...state, repeatMode: action.mode }
    case 'cycleRepeatMode':
      return {
        ...state,
        repeatMode: state.repeatMode === 'off'
          ? 'all'
          : state.repeatMode === 'all'
            ? 'one'
            : 'off',
      }
    case 'unskipEntry': {
      if (!state.nowPlayingEntries.some((entry) => entry.queueId === action.queueId)) return state
      const unskipped = updateEntry(state, action.queueId, (entry) => (
        entry.unskipped && entry.preferenceBaseline === action.preferenceBaseline
          ? entry
          : { ...entry, unskipped: true, preferenceBaseline: action.preferenceBaseline ?? entry.preferenceBaseline }
      ))
      if (unskipped === state && state.unskippedEntryIds.includes(action.queueId)) return state
      return {
        ...unskipped,
        unskippedEntryIds: appendUniqueIds(state.unskippedEntryIds, [action.queueId]),
        queueVersion: state.queueVersion + 1,
      }
    }
    case 'selectMode': {
      const cleared = clearSoftModes(state)
      const selected = updateEntry(cleared, action.queueId, (entry) => ({
        ...entry,
        manualMode: action.mode,
        unskipped: true,
        preferenceBaseline: action.preferenceBaseline,
      }))
      if (selected === state) return state
      return {
        ...selected,
        desiredMode: action.mode,
        unskippedEntryIds: appendUniqueIds(cleared.unskippedEntryIds, [action.queueId]),
        queueVersion: cleared.queueVersion + 1,
      }
    }
    case 'requestReplay': {
      const replay = updateEntry(state, action.queueId, (entry) => ({
        ...entry,
        replayRequested: entry.lastActualMode != null,
        ...(action.explicit ? { unskipped: true, preferenceBaseline: action.preferenceBaseline } : {}),
      }))
      if (replay === state) return state
      return {
        ...replay,
        unskippedEntryIds: action.explicit
          ? appendUniqueIds(state.unskippedEntryIds, [action.queueId])
          : state.unskippedEntryIds,
        queueVersion: state.queueVersion + 1,
      }
    }
    case 'recordActualMode': {
      const updated = updateEntry(state, action.queueId, (entry) => (
        entry.lastActualMode === action.mode ? entry : { ...entry, lastActualMode: action.mode }
      ))
      return updated === state ? state : { ...updated, queueVersion: state.queueVersion + 1 }
    }
    case 'setDesiredMode': {
      const cleared = action.clearSoftModes ? clearSoftModes(state) : state
      if (cleared.desiredMode === action.mode && cleared === state) return state
      return { ...cleared, desiredMode: action.mode, queueVersion: state.queueVersion + 1 }
    }
    case 'invalidatePreferenceOverrides': {
      if (action.queueIds.length === 0) return state
      const queueIds = new Set(action.queueIds)
      const clearEntry = (entry: QueueEntry): QueueEntry => {
        if (!queueIds.has(entry.queueId) || (!entry.unskipped && entry.manualMode == null)) return entry
        const { unskipped: _unskipped, manualMode: _manualMode, preferenceBaseline: _baseline, ...rest } = entry
        return rest
      }
      const nowPlayingEntries = state.nowPlayingEntries.map(clearEntry)
      const originalQueueEntries = state.originalQueueEntries.map(clearEntry)
      const historyEntries = state.historyEntries.map(clearEntry)
      const unskippedEntryIds = state.unskippedEntryIds.filter((id) => !queueIds.has(id))
      const changed = [...state.nowPlayingEntries, ...state.originalQueueEntries, ...state.historyEntries]
        .some((entry) => queueIds.has(entry.queueId) && (entry.unskipped || entry.manualMode != null))
      if (!changed && unskippedEntryIds.length === state.unskippedEntryIds.length) return state
      return {
        ...state,
        originalQueueEntries,
        nowPlayingEntries,
        historyEntries,
        unskippedEntryIds,
        queueVersion: state.queueVersion + 1,
      }
    }
    case 'applySavedPreferenceChanges': {
      if (action.themeIds.length === 0) return state
      const themeIds = new Set(action.themeIds)
      const affectedIds = uniqueEntries([
        ...state.originalQueueEntries,
        ...state.nowPlayingEntries,
        ...state.historyEntries,
      ]).filter((entry) => {
        const themeId = entry.item.itemType === 'THEME' ? entry.item.themeId : undefined
        return themeId != null && themeIds.has(String(themeId))
      }).map((entry) => entry.queueId)
      if (affectedIds.length === 0) return state
      const affected = new Set(affectedIds)
      const clearEntry = (entry: QueueEntry): QueueEntry => {
        if (!affected.has(entry.queueId) || (entry.manualMode == null && !entry.replayRequested)) return entry
        const { manualMode: _manual, replayRequested: _replay, ...rest } = entry
        return rest
      }
      const nowPlayingEntries = state.nowPlayingEntries.map(clearEntry)
      const originalQueueEntries = state.originalQueueEntries.map(clearEntry)
      const historyEntries = state.historyEntries.map(clearEntry)
      const changed = [...state.nowPlayingEntries, ...state.originalQueueEntries, ...state.historyEntries]
        .some((entry) => affected.has(entry.queueId) && (entry.manualMode != null || entry.replayRequested))
      if (!changed) return state
      return {
        ...state,
        nowPlayingEntries,
        originalQueueEntries,
        historyEntries,
        queueVersion: state.queueVersion + 1,
      }
    }
    case 'clear':
      return {
        ...createInitialQueueState(),
        nextQueueEntryId: state.nextQueueEntryId,
        queueVersion: state.queueVersion + 1,
        playRequestGeneration: state.playRequestGeneration + 1,
        repeatMode: state.repeatMode,
        desiredMode: undefined,
      }
    case 'restore':
      return restoreState(action.state)
  }
}

function playContext(state: QueueState, action: Extract<QueueAction, { type: 'play' }>): QueueState {
  if (action.items.length === 0) return state

  const { entries, nextId } = createEntries(action.items, state.nextQueueEntryId)
  const requestedIndex = clampIndex(action.startIndex ?? 0, entries.length)
  const selected = entries[requestedIndex]
  const shuffled = action.shuffle ? shuffleEntries(entries, action.random) : undefined
  const current = action.shuffle && requestedIndex === 0 ? shuffled?.[0] : selected
  if (!current) return state
  const nowPlaying = action.shuffle
    ? [current, ...(requestedIndex === 0
      ? shuffled!.slice(1)
      : shuffleEntries(entries.filter((entry) => entry.queueId !== current.queueId), action.random))]
    : entries
  const suggestedEntryIds = !action.shuffle && action.suggestedFrom !== undefined
    ? entries
      .slice(Math.max(requestedIndex + 1, action.suggestedFrom))
      .map((entry) => entry.queueId)
    : emptyEntryIds
  const currentIndex = action.shuffle ? 0 : requestedIndex

  return {
    ...state,
    originalQueueEntries: entries,
    nowPlayingEntries: nowPlaying,
    currentIndex,
    historyEntries: action.shuffle ? emptyEntries : entries.slice(0, requestedIndex),
    playNextEntryIds: emptyEntryIds,
    addedToQueueEntryIds: emptyEntryIds,
    suggestedEntryIds,
    unskippedEntryIds: emptyEntryIds,
    playedEntryIds: action.shuffle
      ? [current.queueId]
      : entries.slice(0, requestedIndex + 1).map((entry) => entry.queueId),
    isShuffled: Boolean(action.shuffle),
    contextLabel: action.contextLabel ?? state.contextLabel,
    queueVersion: state.queueVersion + 1,
    playRequestGeneration: state.playRequestGeneration + 1,
    nextQueueEntryId: nextId,
    desiredMode: action.desiredMode,
  }
}

function insertAfterCurrent(
  state: QueueState,
  items: readonly QueueItem[],
  markPlayNext: boolean,
): QueueState {
  if (items.length === 0) return state
  const { entries, nextId } = createEntries(items, state.nextQueueEntryId)
  if (state.nowPlayingEntries.length === 0) {
    return standaloneQueue(state, entries, nextId)
  }

  const cleaned = removeSuggestedEntries(state)
  const nowPlaying = [...cleaned.nowPlayingEntries]
  nowPlaying.splice(cleaned.currentIndex + 1, 0, ...entries)
  return {
    ...cleaned,
    nowPlayingEntries: nowPlaying,
    playNextEntryIds: markPlayNext
      ? [...entries.map((entry) => entry.queueId), ...cleaned.playNextEntryIds]
      : cleaned.playNextEntryIds,
    suggestedEntryIds: emptyEntryIds,
    queueVersion: cleaned.queueVersion + 1,
    nextQueueEntryId: nextId,
  }
}

function appendToQueue(state: QueueState, items: readonly QueueItem[]): QueueState {
  if (items.length === 0) return state
  const { entries, nextId } = createEntries(items, state.nextQueueEntryId)
  if (state.nowPlayingEntries.length === 0) {
    return standaloneQueue(state, entries, nextId)
  }

  const cleaned = removeSuggestedEntries(state)
  return {
    ...cleaned,
    nowPlayingEntries: [...cleaned.nowPlayingEntries, ...entries],
    addedToQueueEntryIds: [...cleaned.addedToQueueEntryIds, ...entries.map((entry) => entry.queueId)],
    suggestedEntryIds: emptyEntryIds,
    queueVersion: cleaned.queueVersion + 1,
    nextQueueEntryId: nextId,
  }
}

function standaloneQueue(state: QueueState, entries: readonly QueueEntry[], nextId: QueueEntryId): QueueState {
  return {
    ...state,
    originalQueueEntries: entries,
    nowPlayingEntries: entries,
    currentIndex: 0,
    historyEntries: emptyEntries,
    playNextEntryIds: emptyEntryIds,
    addedToQueueEntryIds: emptyEntryIds,
    suggestedEntryIds: emptyEntryIds,
    unskippedEntryIds: emptyEntryIds,
    playedEntryIds: [entries[0].queueId],
    isShuffled: false,
    contextLabel: state.contextLabel || 'Queue',
    queueVersion: state.queueVersion + 1,
    playRequestGeneration: state.playRequestGeneration + 1,
    nextQueueEntryId: nextId,
    desiredMode: undefined,
  }
}

function removeSuggestedEntries(state: QueueState): QueueState {
  if (state.suggestedEntryIds.length === 0) return state
  const suggested = new Set(state.suggestedEntryIds)
  const currentId = currentQueueEntry(state)?.queueId
  const nowPlaying = state.nowPlayingEntries.filter((entry, index) =>
    index <= state.currentIndex || !suggested.has(entry.queueId),
  )
  const currentIndex = currentId === undefined
    ? Math.min(state.currentIndex, Math.max(0, nowPlaying.length - 1))
    : Math.max(0, nowPlaying.findIndex((entry) => entry.queueId === currentId))

  return {
    ...state,
    nowPlayingEntries: nowPlaying,
    currentIndex,
    suggestedEntryIds: emptyEntryIds,
    playedEntryIds: state.playedEntryIds.filter((id) => nowPlaying.some((entry) => entry.queueId === id)),
  }
}

function transitionToItemId(state: QueueState, itemId: QueueItemId): QueueState {
  const expected = state.nowPlayingEntries[state.currentIndex + 1]
  const nextIndex = expected && sameItemId(expected.item.id, itemId)
    ? state.currentIndex + 1
    : state.nowPlayingEntries.findIndex((entry) => sameItemId(entry.item.id, itemId))
  return nextIndex < 0 ? state : transitionToIndex(state, nextIndex, false, false)
}

function transitionToIndex(
  state: QueueState,
  nextIndex: number,
  bumpQueueVersion: boolean,
  bumpGeneration: boolean,
): QueueState {
  if (state.nowPlayingEntries.length === 0 || nextIndex === state.currentIndex) return state

  const currentIndex = state.currentIndex
  let historyEntries = state.historyEntries
  if (nextIndex > currentIndex && currentIndex >= 0 && currentIndex < state.nowPlayingEntries.length) {
    historyEntries = appendUniqueEntries(
      historyEntries,
      state.nowPlayingEntries.slice(currentIndex, nextIndex),
    )
  } else if (nextIndex < currentIndex) {
    const historyIndex = historyEntries.findIndex(
      (entry) => entry.queueId === state.nowPlayingEntries[nextIndex].queueId,
    )
    if (historyIndex >= 0) historyEntries = historyEntries.slice(0, historyIndex)
  }

  const nextId = state.nowPlayingEntries[nextIndex].queueId
  const transitioned: QueueState = {
    ...state,
    currentIndex: nextIndex,
    historyEntries,
    playedEntryIds: appendUniqueIds(state.playedEntryIds, [nextId]),
    queueVersion: bumpQueueVersion ? state.queueVersion + 1 : state.queueVersion,
    playRequestGeneration: bumpGeneration
      ? state.playRequestGeneration + 1
      : state.playRequestGeneration,
  }
  const previousQueueId = state.nowPlayingEntries[currentIndex]?.queueId
  return previousQueueId === undefined || previousQueueId === nextId
    ? transitioned
    : updateEntry(transitioned, previousQueueId, (entry) => entry.replayRequested ? { ...entry, replayRequested: false } : entry)
}

function moveEntry(state: QueueState, fromQueueId: QueueEntryId, toQueueId: QueueEntryId): QueueState {
  const fromIndex = state.nowPlayingEntries.findIndex((entry) => entry.queueId === fromQueueId)
  const toIndex = state.nowPlayingEntries.findIndex((entry) => entry.queueId === toQueueId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state

  const nowPlaying = [...state.nowPlayingEntries]
  const [entry] = nowPlaying.splice(fromIndex, 1)
  nowPlaying.splice(toIndex, 0, entry)
  return {
    ...state,
    nowPlayingEntries: nowPlaying,
    currentIndex: adjustedCurrentIndex(state.currentIndex, fromIndex, toIndex),
    queueVersion: state.queueVersion + 1,
  }
}

function removeEntry(state: QueueState, queueId: QueueEntryId): QueueState {
  const index = state.nowPlayingEntries.findIndex((entry) => entry.queueId === queueId)
  if (index < 0 || index === state.currentIndex) return state

  const nowPlaying = state.nowPlayingEntries.filter((entry) => entry.queueId !== queueId)
  const original = state.originalQueueEntries.filter((entry) => entry.queueId !== queueId)
  return {
    ...state,
    originalQueueEntries: original,
    nowPlayingEntries: nowPlaying,
    currentIndex: index < state.currentIndex ? state.currentIndex - 1 : state.currentIndex,
    historyEntries: state.historyEntries.filter((entry) => entry.queueId !== queueId),
    playNextEntryIds: state.playNextEntryIds.filter((id) => id !== queueId),
    addedToQueueEntryIds: state.addedToQueueEntryIds.filter((id) => id !== queueId),
    suggestedEntryIds: state.suggestedEntryIds.filter((id) => id !== queueId),
    playedEntryIds: state.playedEntryIds.filter((id) => id !== queueId),
    unskippedEntryIds: state.unskippedEntryIds.filter((id) => id !== queueId),
    queueVersion: state.queueVersion + 1,
  }
}

function moveToPlayNext(state: QueueState, queueId: QueueEntryId): QueueState {
  const index = state.nowPlayingEntries.findIndex((entry) => entry.queueId === queueId)
  if (index < 0 || index === state.currentIndex) return state
  const targetIndex = index > state.currentIndex ? state.currentIndex + 1 : state.currentIndex
  const moved = moveEntry(state, queueId, state.nowPlayingEntries[targetIndex].queueId)
  return {
    ...moved,
    playNextEntryIds: [queueId, ...moved.playNextEntryIds.filter((id) => id !== queueId)],
  }
}

function rewindTo(state: QueueState, historyIndex: number): QueueState {
  if (historyIndex < 0 || historyIndex >= state.historyEntries.length) return state
  const restored = state.historyEntries.slice(historyIndex)
  const tail = state.nowPlayingEntries.slice(state.currentIndex)
  const nowPlaying = [...restored, ...tail]
  const replayQueueId = nowPlaying[0].queueId
  const clearOtherReplay = (entries: readonly QueueEntry[]) => entries.map((entry) => (
    entry.queueId !== replayQueueId && entry.replayRequested ? { ...entry, replayRequested: false } : entry
  ))
  return {
    ...state,
    originalQueueEntries: clearOtherReplay(state.originalQueueEntries),
    nowPlayingEntries: clearOtherReplay(nowPlaying),
    currentIndex: 0,
    historyEntries: clearOtherReplay(state.historyEntries.slice(0, historyIndex)),
    playedEntryIds: [nowPlaying[0].queueId],
    suggestedEntryIds: emptyEntryIds,
    queueVersion: state.queueVersion + 1,
    playRequestGeneration: state.playRequestGeneration + 1,
  }
}

function shuffle(state: QueueState, random?: () => number): QueueState {
  const current = currentQueueEntry(state)
  if (!current) return state
  const allEntries = uniqueEntries([
    ...state.originalQueueEntries,
    ...state.nowPlayingEntries,
    ...state.historyEntries,
  ])
  const byId = new Map(allEntries.map((entry) => [entry.queueId, entry]))
  const pinned = state.playNextEntryIds
    .filter((id) => id !== current.queueId)
    .flatMap((id) => {
      const entry = byId.get(id)
      return entry ? [entry] : []
    })
  const pinnedIds = new Set(pinned.map((entry) => entry.queueId))
  const shuffleable = allEntries.filter(
    (entry) => entry.queueId !== current.queueId && !pinnedIds.has(entry.queueId),
  )
  return {
    ...state,
    nowPlayingEntries: [current, ...pinned, ...shuffleEntries(shuffleable, random)],
    currentIndex: 0,
    historyEntries: emptyEntries,
    playedEntryIds: [current.queueId],
    isShuffled: true,
    queueVersion: state.queueVersion + 1,
  }
}

function unshuffle(state: QueueState): QueueState {
  const current = currentQueueEntry(state)
  if (!current) return state
  const allEntries = uniqueEntries([
    ...state.originalQueueEntries,
    ...state.nowPlayingEntries,
    ...state.historyEntries,
  ])
  const byId = new Map(allEntries.map((entry) => [entry.queueId, entry]))
  const pinnedIds = new Set(state.playNextEntryIds)
  const pinned = state.playNextEntryIds
    .filter((id) => id !== current.queueId)
    .flatMap((id) => {
      const entry = byId.get(id)
      return entry ? [entry] : []
    })
  const originalIndex = state.originalQueueEntries.findIndex((entry) => entry.queueId === current.queueId)
  const sourceBefore = originalIndex >= 0
    ? state.originalQueueEntries.slice(0, originalIndex).filter((entry) => !pinnedIds.has(entry.queueId))
    : emptyEntries
  const sourceAfter = originalIndex >= 0
    ? state.originalQueueEntries.slice(originalIndex + 1).filter((entry) => !pinnedIds.has(entry.queueId))
    : state.originalQueueEntries.filter((entry) => !pinnedIds.has(entry.queueId))
  const placedIds = new Set([
    ...sourceBefore.map((entry) => entry.queueId),
    current.queueId,
    ...pinned.map((entry) => entry.queueId),
    ...sourceAfter.map((entry) => entry.queueId),
  ])
  const added = state.addedToQueueEntryIds.flatMap((id) => {
    const entry = byId.get(id)
    return entry && !placedIds.has(id) ? [entry] : []
  })
  const addedIds = new Set(added.map((entry) => entry.queueId))
  const extra = allEntries.filter((entry) => !placedIds.has(entry.queueId) && !addedIds.has(entry.queueId))
  const nowPlaying = originalIndex >= 0
    ? [...sourceBefore, current, ...pinned, ...sourceAfter, ...added, ...extra]
    : [current, ...pinned, ...sourceAfter, ...added, ...extra]
  const currentIndex = originalIndex >= 0 ? sourceBefore.length : 0
  return {
    ...state,
    nowPlayingEntries: nowPlaying,
    currentIndex,
    historyEntries: nowPlaying.slice(0, currentIndex),
    playedEntryIds: nowPlaying.slice(0, currentIndex + 1).map((entry) => entry.queueId),
    isShuffled: false,
    queueVersion: state.queueVersion + 1,
  }
}

function restoreState(snapshot: QueueState): QueueState {
  const rawEntries = [
    ...snapshot.originalQueueEntries,
    ...snapshot.nowPlayingEntries,
    ...snapshot.historyEntries,
  ]
  const maxId = rawEntries.reduce((max, entry) => Number.isSafeInteger(entry.queueId) && entry.queueId > 0 ? Math.max(max, entry.queueId) : max, 0)
  const normalized = normalizeRestoredEntries(snapshot.nowPlayingEntries, Math.max(snapshot.nextQueueEntryId, maxId + 1))
  const original = remapRestoredEntries(snapshot.originalQueueEntries, normalized.idsByOriginalId, normalized.nextId)
  const history = remapRestoredEntries(uniqueEntries(snapshot.historyEntries), normalized.idsByOriginalId, original.nextId)
  const allEntries = uniqueEntries([...original.entries, ...normalized.entries, ...history.entries])
  const validIds = new Set(allEntries.map((entry) => entry.queueId))
  const currentIndex = normalized.entries.length === 0
    ? 0
    : clampIndex(snapshot.currentIndex, normalized.entries.length)
  const restoredUnskippedIds = appendUniqueIds(
    [],
    [
      ...(snapshot.unskippedEntryIds ?? []),
      ...allEntries.filter((entry) => entry.unskipped).map((entry) => entry.queueId),
    ].filter((id) => validIds.has(id)),
  )
  const restored: QueueState = {
    ...snapshot,
    originalQueueEntries: original.entries,
    nowPlayingEntries: normalized.entries,
    historyEntries: history.entries,
    playNextEntryIds: snapshot.playNextEntryIds.filter((id) => validIds.has(id)),
    addedToQueueEntryIds: snapshot.addedToQueueEntryIds.filter((id) => validIds.has(id)),
    suggestedEntryIds: snapshot.suggestedEntryIds.filter((id) => validIds.has(id)),
    playedEntryIds: appendUniqueIds([], snapshot.playedEntryIds.filter((id) => validIds.has(id))),
    unskippedEntryIds: restoredUnskippedIds,
    currentIndex,
    nextQueueEntryId: history.nextId,
    desiredMode: isPlaybackMode(snapshot.desiredMode) ? snapshot.desiredMode : undefined,
  }
  const current = restored.nowPlayingEntries[currentIndex]
  return current?.lastActualMode
    ? updateEntry(restored, current.queueId, (entry) => entry.replayRequested ? entry : { ...entry, replayRequested: true })
    : restored
}

function updateEntry(state: QueueState, queueId: QueueEntryId, update: (entry: QueueEntry) => QueueEntry): QueueState {
  let changed = false
  const updateEntries = (entries: readonly QueueEntry[]): readonly QueueEntry[] => entries.map((entry) => {
    if (entry.queueId !== queueId) return entry
    const next = update(entry)
    changed ||= next !== entry
    return next
  })
  const originalQueueEntries = updateEntries(state.originalQueueEntries)
  const nowPlayingEntries = updateEntries(state.nowPlayingEntries)
  const historyEntries = updateEntries(state.historyEntries)
  return changed ? { ...state, originalQueueEntries, nowPlayingEntries, historyEntries } : state
}

function clearSoftModes(state: QueueState): QueueState {
  const clear = (entry: QueueEntry): QueueEntry => {
    if (!('softMode' in entry.item) && !('mode' in entry.item)) return entry
    const item = { ...entry.item }
    delete item.softMode
    delete item.mode
    return { ...entry, item }
  }
  const clearEntries = (entries: readonly QueueEntry[]): readonly QueueEntry[] => entries.map(clear)
  return {
    ...state,
    originalQueueEntries: clearEntries(state.originalQueueEntries),
    nowPlayingEntries: clearEntries(state.nowPlayingEntries),
    historyEntries: clearEntries(state.historyEntries),
  }
}

function normalizeRestoredEntries(entries: readonly QueueEntry[], firstId: QueueEntryId): {
  entries: QueueEntry[]
  idsByOriginalId: Map<QueueEntryId, QueueEntryId[]>
  nextId: QueueEntryId
} {
  const used = new Set<QueueEntryId>()
  const idsByOriginalId = new Map<QueueEntryId, QueueEntryId[]>()
  let nextId = firstId
  const normalized = entries.map((entry) => {
    const usable = Number.isSafeInteger(entry.queueId) && entry.queueId > 0 && !used.has(entry.queueId)
    const queueId = usable ? entry.queueId : nextId++
    used.add(queueId)
    const replacements = idsByOriginalId.get(entry.queueId) ?? []
    replacements.push(queueId)
    idsByOriginalId.set(entry.queueId, replacements)
    return queueId === entry.queueId ? entry : { ...entry, queueId }
  })
  return { entries: normalized, idsByOriginalId, nextId }
}

function remapRestoredEntries(
  entries: readonly QueueEntry[],
  idsByOriginalId: ReadonlyMap<QueueEntryId, readonly QueueEntryId[]>,
  firstId: QueueEntryId,
): { entries: QueueEntry[]; nextId: QueueEntryId } {
  const occurrences = new Map<QueueEntryId, number>()
  const used = new Set<QueueEntryId>()
  let nextId = firstId
  const remapped = entries.map((entry) => {
    const occurrence = occurrences.get(entry.queueId) ?? 0
    occurrences.set(entry.queueId, occurrence + 1)
    const candidate = idsByOriginalId.get(entry.queueId)?.[occurrence] ?? entry.queueId
    const usable = Number.isSafeInteger(candidate) && candidate > 0 && !used.has(candidate)
    const queueId = usable ? candidate : nextId++
    used.add(queueId)
    return queueId === entry.queueId ? entry : { ...entry, queueId }
  })
  return { entries: remapped, nextId }
}

function createEntries(items: readonly QueueItem[], nextId: QueueEntryId): {
  entries: readonly QueueEntry[]
  nextId: QueueEntryId
} {
  const entries = items.map((item, offset) => ({ queueId: nextId + offset, item }))
  return { entries, nextId: nextId + entries.length }
}

function shuffleEntries<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomValue = Math.max(0, Math.min(0.999999999, random()))
    const swapIndex = Math.floor(randomValue * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function uniqueEntries(entries: readonly QueueEntry[]): QueueEntry[] {
  const seen = new Set<QueueEntryId>()
  return entries.filter((entry) => {
    if (seen.has(entry.queueId)) return false
    seen.add(entry.queueId)
    return true
  })
}

function appendUniqueEntries(base: readonly QueueEntry[], additions: readonly QueueEntry[]): QueueEntry[] {
  const seen = new Set(base.map((entry) => entry.queueId))
  return [...base, ...additions.filter((entry) => {
    if (seen.has(entry.queueId)) return false
    seen.add(entry.queueId)
    return true
  })]
}

function appendUniqueIds(base: readonly QueueEntryId[], additions: readonly QueueEntryId[]): QueueEntryId[] {
  const seen = new Set(base)
  return [...base, ...additions.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })]
}

function adjustedCurrentIndex(currentIndex: number, fromIndex: number, toIndex: number): number {
  if (fromIndex === currentIndex) return toIndex
  if (fromIndex < currentIndex && toIndex >= currentIndex) return currentIndex - 1
  if (fromIndex > currentIndex && toIndex <= currentIndex) return currentIndex + 1
  return currentIndex
}

function isValidIndex(state: QueueState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.nowPlayingEntries.length
}

function isPlaybackMode(value: unknown): value is PlaybackMode {
  return value === 'TV_SIZE' || value === 'FULL_SIZE' || value === 'VIDEO'
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.max(0, Math.min(length - 1, Math.trunc(index)))
}

function sameItemId(left: QueueItemId, right: QueueItemId): boolean {
  return String(left) === String(right)
}

type QueueListener = (state: QueueState) => void

export class QueueStore {
  private currentState: QueueState
  private readonly listeners = new Set<QueueListener>()
  private readonly random: () => number
  private preferenceSnapshot: QueuePreferenceSnapshot = emptyQueuePreferenceSnapshot
  private preferencesReady = false

  constructor(initialState?: QueueState | QueueStoreOptions, options: QueueStoreOptions = {}) {
    if (initialState && 'nowPlayingEntries' in initialState) {
      this.currentState = restoreState(initialState)
      this.random = options.random ?? Math.random
    } else {
      this.currentState = createInitialQueueState()
      this.random = (initialState as QueueStoreOptions | undefined)?.random ?? options.random ?? Math.random
    }
  }

  get state(): QueueState {
    return this.currentState
  }

  get currentEntry(): QueueEntry | undefined {
    return currentQueueEntry(this.currentState)
  }

  get upNextEntries(): readonly QueueEntry[] {
    return upcomingQueueEntries(this.currentState)
  }

  get playNextEntries(): readonly QueueEntry[] {
    return entriesForIds(this.currentState, this.currentState.playNextEntryIds)
  }

  get addedToQueueEntries(): readonly QueueEntry[] {
    return entriesForIds(this.currentState, this.currentState.addedToQueueEntryIds)
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispatch(action: QueueAction): QueueState {
    const next = queueReducer(this.currentState, action)
    if (next === this.currentState) return this.currentState
    this.currentState = next
    for (const listener of this.listeners) listener(next)
    return next
  }

  /** Updates synchronized preferences and invalidates only exceptions older than a new relevant dislike. */
  setPreferenceSnapshot(snapshot: QueuePreferenceSnapshot | undefined, ready = true): void {
    const previous = this.preferenceSnapshot
    const next = snapshot ?? emptyQueuePreferenceSnapshot
    const previouslyReady = this.preferencesReady
    this.preferenceSnapshot = next
    if (!ready) return
    this.preferencesReady = true
    if (previouslyReady) {
      const themeIds = new Set([...Object.keys(previous.themesById), ...Object.keys(next.themesById)])
      const changedPreferredModes = [...themeIds].filter((themeId) =>
        (previous.themesById[themeId]?.preferredMode ?? null) !== (next.themesById[themeId]?.preferredMode ?? null),
      )
      if (changedPreferredModes.length > 0) this.dispatch({ type: 'applySavedPreferenceChanges', themeIds: changedPreferredModes })
    }
    const all = uniqueEntries([
      ...this.currentState.originalQueueEntries,
      ...this.currentState.nowPlayingEntries,
      ...this.currentState.historyEntries,
    ])
    const missingBaseline = all.filter((entry) => (entry.unskipped || entry.manualMode != null) && entry.preferenceBaseline == null)
    let baselineChanged = false
    for (const entry of missingBaseline) {
      const baseline = queueEntryDislikeFingerprint(entry, this.preferenceSnapshot, entry.manualMode ?? entry.lastActualMode)
      const updated = updateEntry(this.currentState, entry.queueId, (candidate) => ({ ...candidate, preferenceBaseline: baseline }))
      if (updated !== this.currentState) {
        this.currentState = updated
        baselineChanged = true
      }
    }
    const invalid = all
      .filter((entry) => (entry.unskipped || entry.manualMode != null) && entry.preferenceBaseline != null)
      .filter((entry) => newlyDislikedFingerprint(
        entry.preferenceBaseline!,
        queueEntryDislikeFingerprint(entry, this.preferenceSnapshot, entry.manualMode ?? entry.lastActualMode),
      ))
      .map((entry) => entry.queueId)
    const invalidSet = new Set(invalid)
    for (const entry of all) {
      if (invalidSet.has(entry.queueId) || (!entry.unskipped && entry.manualMode == null) || entry.preferenceBaseline == null) continue
      const nextBaseline = queueEntryDislikeFingerprint(entry, this.preferenceSnapshot, entry.manualMode ?? entry.lastActualMode)
      if (nextBaseline === entry.preferenceBaseline) continue
      const updated = updateEntry(this.currentState, entry.queueId, (candidate) => ({ ...candidate, preferenceBaseline: nextBaseline }))
      if (updated !== this.currentState) {
        this.currentState = updated
        baselineChanged = true
      }
    }
    if (invalid.length > 0) {
      this.dispatch({ type: 'invalidatePreferenceOverrides', queueIds: invalid })
    } else if (baselineChanged) {
      this.currentState = { ...this.currentState, queueVersion: this.currentState.queueVersion + 1 }
      for (const listener of this.listeners) listener(this.currentState)
    }
  }

  /** Allows one explicitly selected queue occurrence to play for the current session. */
  unskipEntry(queueId: QueueEntryId): QueueState {
    const entry = this.currentState.nowPlayingEntries.find((candidate) => candidate.queueId === queueId)
    return this.dispatch({
      type: 'unskipEntry',
      queueId,
      preferenceBaseline: entry ? queueEntryDislikeFingerprint(entry, this.preferenceSnapshot) : undefined,
    })
  }

  selectMode(queueId: QueueEntryId, mode: PlaybackMode): QueueState {
    const entry = this.currentState.nowPlayingEntries.find((candidate) => candidate.queueId === queueId)
    if (!entry) return this.currentState
    return this.dispatch({
      type: 'selectMode',
      queueId,
      mode,
      preferenceBaseline: queueEntryDislikeFingerprint(entry, this.preferenceSnapshot, mode),
    })
  }

  requestReplay(queueId: QueueEntryId, explicit = false): QueueState {
    const entry = this.currentState.nowPlayingEntries.find((candidate) => candidate.queueId === queueId)
      ?? this.currentState.historyEntries.find((candidate) => candidate.queueId === queueId)
    if (!entry) return this.currentState
    return this.dispatch({
      type: 'requestReplay',
      queueId,
      explicit,
      preferenceBaseline: explicit
        ? queueEntryDislikeFingerprint(entry, this.preferenceSnapshot, entry.lastActualMode)
        : undefined,
    })
  }

  play(items: readonly QueueItem[], options: PlayOptions = {}): QueueState {
    if (items.length === 0) return this.currentState
    const requestedIndex = clampIndex(options.startIndex ?? 0, items.length)
    return this.dispatch({ type: 'play', items, ...options, startIndex: requestedIndex, random: options.random ?? this.random })
  }

  recordActualMode(queueId: QueueEntryId, mode: PlaybackMode): QueueState {
    return this.dispatch({ type: 'recordActualMode', queueId, mode })
  }

  setDesiredMode(mode?: PlaybackMode, clearSoftModes = false): QueueState {
    return this.dispatch({ type: 'setDesiredMode', mode, clearSoftModes })
  }

  playNext(items: readonly QueueItem[]): QueueState {
    return this.dispatch({ type: 'playNext', items })
  }

  addToQueue(items: readonly QueueItem[]): QueueState {
    return this.dispatch({ type: 'addToQueue', items })
  }

  trackChangedByEntryId(queueId: QueueEntryId): QueueState {
    return this.dispatch({ type: 'trackChangedByEntryId', queueId })
  }

  trackChangedByItemId(itemId: QueueItemId): QueueState {
    return this.dispatch({ type: 'trackChangedByItemId', itemId })
  }

  skipTo(index: number): QueueState {
    return this.dispatch({ type: 'skipTo', index })
  }

  /** Advances according to repeat mode and returns the resulting index, or null at the end. */
  next(): number | null {
    const nextIndex = nextEligibleQueueIndex(
      this.currentState.nowPlayingEntries,
      this.currentState.currentIndex,
      this.currentState.repeatMode,
      this.preferenceSnapshot,
      new Set(this.currentState.unskippedEntryIds),
      this.currentState.desiredMode ?? 'TV_SIZE',
    )
    if (nextIndex !== null && nextIndex === this.currentState.currentIndex && this.currentState.repeatMode === 'one') {
      const entry = this.currentState.nowPlayingEntries[nextIndex]
      if (entry) this.requestReplay(entry.queueId, false)
    } else if (nextIndex !== null && nextIndex !== this.currentState.currentIndex) {
      const target = this.currentState.nowPlayingEntries[nextIndex]
      if (target?.lastActualMode && this.currentState.playedEntryIds.includes(target.queueId)) {
        this.requestReplay(target.queueId, false)
      }
      this.dispatch({ type: 'advanceTo', index: nextIndex })
    }
    return nextIndex
  }

  moveEntry(fromQueueId: QueueEntryId, toQueueId: QueueEntryId): QueueState {
    return this.dispatch({ type: 'moveEntry', fromQueueId, toQueueId })
  }

  removeEntry(queueId: QueueEntryId): QueueState {
    return this.dispatch({ type: 'removeEntry', queueId })
  }

  moveToPlayNext(queueId: QueueEntryId): QueueState {
    return this.dispatch({ type: 'moveToPlayNext', queueId })
  }

  rewindTo(historyIndex: number, explicit = false): QueueState {
    const entry = this.currentState.historyEntries[historyIndex]
    if (entry) this.requestReplay(entry.queueId, explicit)
    return this.dispatch({ type: 'rewindTo', historyIndex })
  }

  previousHistoryIndex(): number | null {
    for (let index = this.currentState.historyEntries.length - 1; index >= 0; index -= 1) {
      const entry = this.currentState.historyEntries[index]
      if (isQueueEntryAllowedByPreference(
        { ...entry, replayRequested: true },
        this.preferenceSnapshot,
        new Set(this.currentState.unskippedEntryIds),
        undefined,
        this.currentState.desiredMode ?? 'TV_SIZE',
      )) return index
    }
    return null
  }

  setShuffled(shuffled: boolean): QueueState {
    return this.dispatch({ type: 'setShuffled', shuffled, random: this.random })
  }

  toggleShuffle(): QueueState {
    return this.dispatch({ type: 'toggleShuffle', random: this.random })
  }

  setRepeatMode(mode: RepeatMode): QueueState {
    return this.dispatch({ type: 'setRepeatMode', mode })
  }

  cycleRepeatMode(): RepeatMode {
    return this.dispatch({ type: 'cycleRepeatMode' }).repeatMode
  }

  clear(): QueueState {
    return this.dispatch({ type: 'clear' })
  }

  restore(state: QueueState): QueueState {
    return this.dispatch({ type: 'restore', state })
  }
}

function newlyDislikedFingerprint(previous: string, next: string): boolean {
  const previousBits = previous.split(':').slice(1)
  const nextBits = next.split(':').slice(1)
  return nextBits.some((bit, index) => bit === '1' && previousBits[index] !== '1')
}
