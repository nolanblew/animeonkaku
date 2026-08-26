/**
 * Browser playback queue domain.
 *
 * Queue entries deliberately have an identity separate from the media item id.
 * The same song can therefore be present in a context queue, Play Next, and a
 * manually appended queue without one occurrence stealing another occurrence's
 * history or playback position.
 */

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
  /** Internal monotonic allocator. It is persisted in the snapshot so restores cannot reuse ids. */
  readonly nextQueueEntryId: QueueEntryId
}

export interface PlayOptions {
  readonly contextLabel?: string
  readonly startIndex?: number
  readonly shuffle?: boolean
  readonly suggestedFrom?: number
  /** Injectable for deterministic tests and a future seeded queue preference. */
  readonly random?: () => number
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
    nextQueueEntryId: 1,
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
    case 'clear':
      return {
        ...createInitialQueueState(),
        nextQueueEntryId: state.nextQueueEntryId,
        queueVersion: state.queueVersion + 1,
        playRequestGeneration: state.playRequestGeneration + 1,
        repeatMode: state.repeatMode,
      }
    case 'restore':
      return restoreState(action.state)
  }
}

function playContext(state: QueueState, action: Extract<QueueAction, { type: 'play' }>): QueueState {
  if (action.items.length === 0) return state

  const { entries, nextId } = createEntries(action.items, state.nextQueueEntryId)
  const requestedIndex = clampIndex(action.startIndex ?? 0, entries.length)
  const current = entries[requestedIndex]
  const nowPlaying = action.shuffle
    ? [current, ...shuffleEntries(entries.filter((entry) => entry.queueId !== current.queueId), action.random)]
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
    playedEntryIds: action.shuffle
      ? [current.queueId]
      : entries.slice(0, requestedIndex + 1).map((entry) => entry.queueId),
    isShuffled: Boolean(action.shuffle),
    contextLabel: action.contextLabel ?? state.contextLabel,
    queueVersion: state.queueVersion + 1,
    playRequestGeneration: state.playRequestGeneration + 1,
    nextQueueEntryId: nextId,
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
    playedEntryIds: [entries[0].queueId],
    isShuffled: false,
    contextLabel: state.contextLabel || 'Queue',
    queueVersion: state.queueVersion + 1,
    playRequestGeneration: state.playRequestGeneration + 1,
    nextQueueEntryId: nextId,
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
  return {
    ...state,
    currentIndex: nextIndex,
    historyEntries,
    playedEntryIds: appendUniqueIds(state.playedEntryIds, [nextId]),
    queueVersion: bumpQueueVersion ? state.queueVersion + 1 : state.queueVersion,
    playRequestGeneration: bumpGeneration
      ? state.playRequestGeneration + 1
      : state.playRequestGeneration,
  }
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
  return {
    ...state,
    nowPlayingEntries: nowPlaying,
    currentIndex: 0,
    historyEntries: state.historyEntries.slice(0, historyIndex),
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
  const allEntries = uniqueEntries([
    ...snapshot.originalQueueEntries,
    ...snapshot.nowPlayingEntries,
    ...snapshot.historyEntries,
  ])
  const maxId = allEntries.reduce((max, entry) => Math.max(max, entry.queueId), 0)
  const validIds = new Set(allEntries.map((entry) => entry.queueId))
  const currentIndex = snapshot.nowPlayingEntries.length === 0
    ? 0
    : clampIndex(snapshot.currentIndex, snapshot.nowPlayingEntries.length)
  return {
    ...snapshot,
    historyEntries: uniqueEntries(snapshot.historyEntries),
    playNextEntryIds: snapshot.playNextEntryIds.filter((id) => validIds.has(id)),
    addedToQueueEntryIds: snapshot.addedToQueueEntryIds.filter((id) => validIds.has(id)),
    suggestedEntryIds: snapshot.suggestedEntryIds.filter((id) => validIds.has(id)),
    playedEntryIds: appendUniqueIds([], snapshot.playedEntryIds.filter((id) => validIds.has(id))),
    currentIndex,
    nextQueueEntryId: Math.max(snapshot.nextQueueEntryId, maxId + 1),
  }
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

  play(items: readonly QueueItem[], options: PlayOptions = {}): QueueState {
    return this.dispatch({ type: 'play', items, ...options, random: options.random ?? this.random })
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
    const nextIndex = nextQueueIndex(this.currentState)
    if (nextIndex !== null && nextIndex !== this.currentState.currentIndex) {
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

  rewindTo(historyIndex: number): QueueState {
    return this.dispatch({ type: 'rewindTo', historyIndex })
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
