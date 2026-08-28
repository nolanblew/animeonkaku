import { describe, expect, it } from 'vitest'

import {
  QueueStore,
  createInitialQueueState,
  nextQueueIndex,
  type QueueItem,
  type RepeatMode,
} from './queue'

const song = (id: number | string, title = `Song ${id}`): QueueItem => ({
  id,
  title,
  durationMs: 120_000,
})

const itemIds = (store: QueueStore) => store.state.nowPlayingEntries.map((entry) => entry.item.id)
const entryIds = (store: QueueStore) => store.state.nowPlayingEntries.map((entry) => entry.queueId)

describe('QueueStore', () => {
  it('starts empty and exposes stable derived current/up-next views', () => {
    const store = new QueueStore()

    expect(store.state).toEqual(expect.objectContaining({
      currentIndex: 0,
      nowPlayingEntries: [],
      historyEntries: [],
      isShuffled: false,
      repeatMode: 'off',
    }))
    expect(store.currentEntry).toBeUndefined()
    expect(store.upNextEntries).toEqual([])
  })

  it('creates distinct queue-entry identities for duplicate songs', () => {
    const store = new QueueStore()

    store.play([song(1), song(1), song(2)])

    expect(itemIds(store)).toEqual([1, 1, 2])
    expect(new Set(entryIds(store)).size).toBe(3)
    expect(store.state.originalQueueEntries.map((entry) => entry.queueId)).toEqual(entryIds(store))
  })

  it('plays a selected item in place when starting an unshuffled context', () => {
    const store = new QueueStore()

    store.play([song(1), song(2), song(3)], { contextLabel: 'Album', startIndex: 1 })

    expect(store.state.contextLabel).toBe('Album')
    expect(itemIds(store)).toEqual([1, 2, 3])
    expect(store.state.currentIndex).toBe(1)
    expect(store.currentEntry?.item.id).toBe(2)
    expect(store.state.historyEntries.map((entry) => entry.item.id)).toEqual([1])
    expect(store.state.playedEntryIds).toEqual([entryIds(store)[0], entryIds(store)[1]])
  })

  it('starts a shuffled context with the selected entry first and retains every identity', () => {
    const store = new QueueStore({ random: () => 0 })

    store.play([song(1), song(2), song(3), song(4)], { startIndex: 2, shuffle: true })

    expect(store.state.isShuffled).toBe(true)
    expect(store.state.currentIndex).toBe(0)
    expect(store.currentEntry?.item.id).toBe(3)
    expect(new Set(entryIds(store)).size).toBe(4)
    expect(new Set(itemIds(store))).toEqual(new Set([1, 2, 3, 4]))
    expect(store.state.historyEntries).toEqual([])
  })

  it('randomizes the first item when starting a shuffled context from the beginning', () => {
    const store = new QueueStore({ random: () => 0 })

    store.play([song(1), song(2), song(3), song(4)], { shuffle: true })

    expect(store.state.isShuffled).toBe(true)
    expect(store.state.currentIndex).toBe(0)
    expect(itemIds(store)).toEqual([2, 3, 4, 1])
    expect(store.currentEntry?.item.id).toBe(2)
  })

  it('Play Next bootstraps an empty queue in input order', () => {
    const store = new QueueStore()

    store.playNext([song(1), song(2), song(3)])

    expect(itemIds(store)).toEqual([1, 2, 3])
    expect(store.state.currentIndex).toBe(0)
    expect(store.currentEntry?.item.id).toBe(1)
    expect(store.state.originalQueueEntries.map((entry) => entry.item.id)).toEqual([1, 2, 3])
    expect(new Set(entryIds(store)).size).toBe(3)
  })

  it('repeated Play Next calls stack newest-first while a batch stays in order', () => {
    const store = new QueueStore()
    store.play([song(1), song(2)])

    store.playNext([song(10), song(11), song(12)])
    store.playNext([song(20)])

    expect(itemIds(store)).toEqual([1, 20, 10, 11, 12, 2])
    expect(store.playNextEntries.map((entry) => entry.item.id)).toEqual([20, 10, 11, 12])
  })

  it('Add to Queue bootstraps an empty queue and appends later batches', () => {
    const store = new QueueStore()

    store.addToQueue([song(1), song(2)])
    store.addToQueue([song(3), song(4)])

    expect(itemIds(store)).toEqual([1, 2, 3, 4])
    expect(store.state.currentIndex).toBe(0)
    expect(store.addedToQueueEntries.map((entry) => entry.item.id)).toEqual([3, 4])
  })

  it('adds duplicate songs as copies without mutating the original occurrence', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(3)])
    const originalId = store.state.nowPlayingEntries[0].queueId

    store.addToQueue([song(1)])
    store.playNext([song(1)])

    const occurrences = store.state.nowPlayingEntries.filter((entry) => entry.item.id === 1)
    expect(occurrences).toHaveLength(3)
    expect(occurrences[0].queueId).toBe(originalId)
    expect(new Set(occurrences.map((entry) => entry.queueId)).size).toBe(3)
  })

  it('removes suggested entries before manual Play Next/Add to Queue changes', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(3), song(4)], { suggestedFrom: 2 })

    expect(store.state.suggestedEntryIds).toHaveLength(2)
    store.playNext([song(9)])

    expect(itemIds(store)).toEqual([1, 9, 2])
    expect(store.state.suggestedEntryIds).toEqual([])
  })

  it('tracks forward transitions by entry identity and does not duplicate history', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(1), song(3)])
    const entries = store.state.nowPlayingEntries

    store.trackChangedByEntryId(entries[2].queueId)
    store.trackChangedByEntryId(entries[3].queueId)

    expect(store.state.currentIndex).toBe(3)
    expect(store.state.historyEntries.map((entry) => entry.queueId)).toEqual([
      entries[0].queueId,
      entries[1].queueId,
      entries[2].queueId,
    ])
    expect(new Set(store.state.historyEntries.map((entry) => entry.queueId)).size).toBe(3)
  })

  it('uses the expected next duplicate when a media callback only supplies item id', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(1)])
    store.skipTo(1)

    store.trackChangedByItemId(1)

    expect(store.state.currentIndex).toBe(2)
    expect(store.currentEntry?.item.id).toBe(1)
    expect(store.state.historyEntries.map((entry) => entry.item.id)).toEqual([1, 2])
  })

  it('skip forward marks skipped entries played and backward navigation trims history by identity', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(3), song(4)])

    store.skipTo(3)
    expect(store.state.historyEntries.map((entry) => entry.item.id)).toEqual([1, 2, 3])
    expect(store.state.playedEntryIds).toHaveLength(4)

    store.skipTo(1)
    expect(store.state.currentIndex).toBe(1)
    expect(store.state.historyEntries.map((entry) => entry.item.id)).toEqual([1])
    expect(new Set(store.state.historyEntries.map((entry) => entry.queueId)).size).toBe(1)
  })

  it('moves and removes by stable queue-entry identity, preserving duplicates', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(1), song(3)])
    const entries = store.state.nowPlayingEntries

    store.moveEntry(entries[2].queueId, entries[1].queueId)
    expect(itemIds(store)).toEqual([1, 1, 2, 3])
    expect(store.state.nowPlayingEntries[1].queueId).toBe(entries[2].queueId)

    store.removeEntry(entries[1].queueId)
    expect(itemIds(store)).toEqual([1, 1, 3])
    expect(store.state.nowPlayingEntries.some((entry) => entry.queueId === entries[1].queueId)).toBe(false)
  })

  it('does not remove the currently playing entry through ordinary queue removal', () => {
    const store = new QueueStore()
    store.play([song(1), song(2)])
    const currentId = store.currentEntry!.queueId

    store.removeEntry(currentId)

    expect(entryIds(store)).toEqual([currentId, store.state.nowPlayingEntries[1].queueId])
  })

  it('moves an entry to Play Next and keeps it pinned when shuffle is enabled', () => {
    const store = new QueueStore({ random: () => 0 })
    store.play([song(1), song(2), song(3), song(4)])
    const movedId = store.state.nowPlayingEntries[3].queueId

    store.moveToPlayNext(movedId)
    store.setShuffled(true)

    expect(store.state.nowPlayingEntries[1].queueId).toBe(movedId)
    expect(store.playNextEntries.map((entry) => entry.queueId)).toEqual([movedId])
  })

  it('shuffles all known occurrences but unshuffles around the exact current identity', () => {
    const store = new QueueStore({ random: () => 0 })
    store.play([song(1), song(2), song(3), song(4)], { startIndex: 2 })
    const currentId = store.currentEntry!.queueId
    store.addToQueue([song(2)])
    const addedId = store.state.nowPlayingEntries.at(-1)!.queueId

    store.setShuffled(true)
    store.setShuffled(false)

    expect(store.state.isShuffled).toBe(false)
    expect(store.currentEntry?.queueId).toBe(currentId)
    expect(store.state.nowPlayingEntries.slice(0, 4).map((entry) => entry.item.id)).toEqual([1, 2, 3, 4])
    expect(store.state.nowPlayingEntries.at(-1)?.queueId).toBe(addedId)
    expect(new Set(store.state.nowPlayingEntries.map((entry) => entry.queueId)).size).toBe(5)
  })

  it('rewinds to history while preserving the current queue tail', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(3)])
    store.skipTo(2)

    const historyEntryId = store.state.historyEntries[0].queueId
    store.rewindTo(0)

    expect(store.state.currentIndex).toBe(0)
    expect(store.currentEntry?.queueId).toBe(historyEntryId)
    expect(itemIds(store)).toEqual([1, 2, 3])
    expect(store.state.historyEntries).toEqual([])
  })

  it('supports repeat-one, repeat-all, and repeat-off next-index behavior', () => {
    const store = new QueueStore()
    store.play([song(1), song(2), song(3)])
    store.skipTo(2)

    const modes: RepeatMode[] = ['one', 'all', 'off']
    expect(modes.map((mode) => nextQueueIndex(store.state, mode))).toEqual([2, 0, null])

    store.setRepeatMode('one')
    expect(store.next()).toBe(2)
    expect(store.currentEntry?.item.id).toBe(3)
    store.setRepeatMode('all')
    expect(store.next()).toBe(0)
    expect(store.currentEntry?.item.id).toBe(1)
  })

  it('cycles repeat mode in the media-player order off -> all -> one -> off', () => {
    const store = new QueueStore(createInitialQueueState())

    expect(store.cycleRepeatMode()).toBe('all')
    expect(store.cycleRepeatMode()).toBe('one')
    expect(store.cycleRepeatMode()).toBe('off')
  })

  it('notifies subscribers only after a state transition and supports unsubscribe', () => {
    const store = new QueueStore()
    const seen: number[] = []
    const unsubscribe = store.subscribe((state) => seen.push(state.queueVersion))

    store.play([])
    store.play([song(1)])
    unsubscribe()
    store.addToQueue([song(2)])

    expect(seen).toEqual([1])
  })

  it('ignores empty, invalid, and duplicate no-op mutations without changing the snapshot', () => {
    const store = new QueueStore()
    const initial = store.state

    store.play([])
    store.playNext([])
    store.addToQueue([])
    store.trackChangedByEntryId(999)
    store.trackChangedByItemId('missing')
    store.skipTo(-1)
    store.skipTo(999)
    store.moveEntry(1, 2)
    store.removeEntry(999)
    store.moveToPlayNext(999)
    store.rewindTo(0)
    store.setShuffled(false)
    store.setRepeatMode('off')

    expect(store.state).toBe(initial)
  })

  it('restores snapshots without duplicate history or stale metadata ids', () => {
    const first = new QueueStore()
    first.play([song(1), song(2)])
    first.skipTo(1)
    const snapshot = first.state
    const duplicateIdEntry = { ...snapshot.nowPlayingEntries[0], item: song(99) }

    const restored = new QueueStore({
      ...snapshot,
      originalQueueEntries: [...snapshot.originalQueueEntries, duplicateIdEntry],
      nowPlayingEntries: [...snapshot.nowPlayingEntries, duplicateIdEntry],
      historyEntries: [...snapshot.historyEntries, snapshot.historyEntries[0]],
      playNextEntryIds: [...snapshot.playNextEntryIds, 999],
      addedToQueueEntryIds: [...snapshot.addedToQueueEntryIds, 999],
      suggestedEntryIds: [...snapshot.suggestedEntryIds, 999],
      playedEntryIds: [...snapshot.playedEntryIds, snapshot.playedEntryIds[0]],
      nextQueueEntryId: 1,
    })

    expect(restored.state.historyEntries.map((entry) => entry.queueId)).toEqual([
      snapshot.historyEntries[0].queueId,
    ])
    expect(restored.state.playNextEntryIds).not.toContain(999)
    expect(restored.state.addedToQueueEntryIds).not.toContain(999)
    expect(restored.state.suggestedEntryIds).not.toContain(999)
    expect(restored.state.playedEntryIds).toEqual([...new Set(snapshot.playedEntryIds)])
    expect(restored.state.nextQueueEntryId).toBeGreaterThan(Math.max(...entryIds(first)))
    expect(restored.state.nowPlayingEntries.map((entry) => entry.item.id)).toEqual([1, 2, 99])
    expect(new Set(restored.state.nowPlayingEntries.map((entry) => entry.queueId)).size).toBe(3)
    expect(new Set(restored.state.originalQueueEntries.map((entry) => entry.queueId)).size).toBe(3)
  })

  it('unshuffles with an appended entry as the current identity', () => {
    const store = new QueueStore({ random: () => 0 })
    store.play([song(1), song(2), song(3)])
    store.addToQueue([song(9)])
    const appendedId = store.state.nowPlayingEntries[3].queueId

    store.setShuffled(true)
    const shuffledIndex = store.state.nowPlayingEntries.findIndex((entry) => entry.queueId === appendedId)
    store.skipTo(shuffledIndex)
    store.setShuffled(false)

    expect(store.currentEntry?.queueId).toBe(appendedId)
    expect(store.state.currentIndex).toBe(0)
    expect(store.state.nowPlayingEntries.map((entry) => entry.item.id)).toContain(9)
    expect(new Set(store.state.nowPlayingEntries.map((entry) => entry.queueId)).size).toBe(4)
  })

  it('handles the end of each repeat mode without inventing a next entry', () => {
    const store = new QueueStore()
    store.play([song(1)])
    expect(store.next()).toBeNull()

    store.setRepeatMode('one')
    expect(store.next()).toBe(0)
    store.setRepeatMode('all')
    expect(store.next()).toBe(0)
  })
})
