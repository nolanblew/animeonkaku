import { describe, expect, it } from 'vitest'

import {
  desiredCurrentQueueIndex,
  filterQueueEntriesForPlayback,
  isQueueEntryAllowedByPreference,
  type QueuePreferenceSnapshot,
} from './preferenceQueue'
import { QueueStore, type QueueEntry, type QueueItem } from './queue'

const emptyPreferences: QueuePreferenceSnapshot = {
  themesById: {},
  songsById: {},
}

const theme = (id: number, mode: 'TV_SIZE' | 'FULL_SIZE' = 'TV_SIZE'): QueueItem => ({
  id: `theme-${id}-${mode}`,
  title: `Theme ${id}`,
  itemType: 'THEME',
  themeId: id,
  mode,
})

const song = (id: number): QueueItem => ({
  id: `song-${id}`,
  title: `Song ${id}`,
  itemType: 'SONG',
  songId: id,
  mode: 'FULL_SIZE',
})

const entry = (queueId: number, item: QueueItem): QueueEntry => ({ queueId, item })

describe('preference-aware browser playback queue', () => {
  it('excludes broadly disliked themes, mode-scoped dislikes, and disliked songs from automatic playback', () => {
    const entries = [
      entry(1, theme(1)),
      entry(2, theme(2, 'TV_SIZE')),
      entry(3, theme(2, 'FULL_SIZE')),
      entry(4, song(4)),
      entry(5, theme(5)),
    ]
    const preferences: QueuePreferenceSnapshot = {
      themesById: {
        1: { disliked: true },
        2: { dislikedTvSize: true },
      },
      songsById: { 4: { disliked: true } },
    }

    expect(filterQueueEntriesForPlayback(entries, preferences).map((value) => value.queueId)).toEqual([3, 5])
  })

  it('keeps only the explicitly unskipped disliked occurrence, preserving duplicate identities', () => {
    const entries = [entry(10, theme(7)), entry(11, theme(7)), entry(12, theme(8))]
    const preferences: QueuePreferenceSnapshot = { themesById: { 7: { disliked: true } }, songsById: {} }

    expect(filterQueueEntriesForPlayback(entries, preferences, new Set([11])).map((value) => value.queueId)).toEqual([11, 12])
    expect(isQueueEntryAllowedByPreference(entries[0]!, preferences, new Set([11]))).toBe(false)
    expect(isQueueEntryAllowedByPreference(entries[1]!, preferences, new Set([11]))).toBe(true)
  })

  it('retains a manually selected disliked current item while automatic traversal advances to the next eligible entry', () => {
    const entries = [entry(20, theme(20)), entry(21, theme(21)), entry(22, theme(22))]
    const preferences: QueuePreferenceSnapshot = { themesById: { 20: { disliked: true }, 21: { disliked: true } }, songsById: {} }
    const playable = filterQueueEntriesForPlayback(entries, preferences, new Set([20]))

    expect(playable.map((value) => value.queueId)).toEqual([20, 22])
    expect(desiredCurrentQueueIndex(entries, 20, playable.map((value) => value.queueId))).toBe(0)
    expect(desiredCurrentQueueIndex(entries, 21, playable.map((value) => value.queueId))).toBe(1)
  })

  it('filters a playlist context and its shuffled form without changing the surviving occurrence identities', () => {
    const store = new QueueStore({ random: () => 0 })
    const preferences: QueuePreferenceSnapshot = { themesById: { 2: { disliked: true } }, songsById: {} }
    store.play([theme(1), theme(2), theme(1), theme(3)], { shuffle: true })

    const playable = filterQueueEntriesForPlayback(store.state.nowPlayingEntries, preferences)

    expect(playable.map((value) => value.item.id)).toEqual(expect.arrayContaining(['theme-1-TV_SIZE', 'theme-1-TV_SIZE', 'theme-3-TV_SIZE']))
    expect(playable.some((value) => value.item.id === 'theme-2-TV_SIZE')).toBe(false)
    expect(new Set(playable.map((value) => value.queueId)).size).toBe(3)
  })

  it('applies dislike filtering to both Play Next and Add to Queue items while keeping eligible manual duplicates', () => {
    const store = new QueueStore()
    const preferences: QueuePreferenceSnapshot = {
      themesById: { 3: { disliked: true } },
      songsById: { 4: { disliked: true } },
    }
    store.play([theme(1), theme(2)])
    store.playNext([theme(3), theme(1)])
    store.addToQueue([song(4), theme(1)])

    const playable = filterQueueEntriesForPlayback(store.state.nowPlayingEntries, preferences)

    expect(playable.map((value) => value.item.id)).toEqual(['theme-1-TV_SIZE', 'theme-1-TV_SIZE', 'theme-2-TV_SIZE', 'theme-1-TV_SIZE'])
    expect(new Set(playable.filter((value) => value.item.id === 'theme-1-TV_SIZE').map((value) => value.queueId)).size).toBe(3)
  })

  it('reconciles preference changes in the playable projection while retaining the logical queue for an unskip', () => {
    const entries = [entry(30, theme(30)), entry(31, theme(31)), entry(32, song(32))]
    const before = filterQueueEntriesForPlayback(entries, emptyPreferences, new Set([30]))
    const after = filterQueueEntriesForPlayback(entries, {
      themesById: { 30: { disliked: true }, 31: { disliked: true } },
      songsById: { 32: { disliked: true } },
    }, new Set([30]))

    expect(before.map((value) => value.queueId)).toEqual([30, 31, 32])
    expect(after.map((value) => value.queueId)).toEqual([30])
    expect(entries.map((value) => value.queueId)).toEqual([30, 31, 32])
  })

  it('retains disliked occurrences in QueueStore while automatic next skips them and one duplicate can be unskipped', () => {
    const store = new QueueStore()
    store.setPreferenceSnapshot({ themesById: { 40: { disliked: true }, 41: { disliked: true } }, songsById: {} })
    const repeated = theme(40)

    store.play([theme(41), repeated, repeated, theme(42)])

    expect(store.state.nowPlayingEntries.map((value) => value.item.id)).toEqual(['theme-41-TV_SIZE', 'theme-40-TV_SIZE', 'theme-40-TV_SIZE', 'theme-42-TV_SIZE'])
    expect(filterQueueEntriesForPlayback(store.state.nowPlayingEntries, { themesById: { 40: { disliked: true }, 41: { disliked: true } }, songsById: {} }).map((value) => value.queueId)).toEqual([store.state.nowPlayingEntries[3]!.queueId])
    expect(store.next()).toBe(3)
    expect(store.currentEntry?.item.id).toBe('theme-42-TV_SIZE')

    store.play([theme(42), repeated, repeated], { startIndex: 0 })
    const duplicateToUnskip = store.state.nowPlayingEntries[2]!
    store.unskipEntry(duplicateToUnskip.queueId)

    expect(store.state.unskippedEntryIds).toEqual([duplicateToUnskip.queueId])
    expect(store.next()).toBe(2)
    expect(store.currentEntry?.queueId).toBe(duplicateToUnskip.queueId)

    store.playNext([theme(41)])
    store.addToQueue([song(43)])
    store.setPreferenceSnapshot({ themesById: { 40: { disliked: true }, 41: { disliked: true } }, songsById: { 43: { disliked: true } } })

    expect(store.state.nowPlayingEntries.map((value) => value.item.id)).toEqual(['theme-42-TV_SIZE', 'theme-40-TV_SIZE', 'theme-40-TV_SIZE', 'theme-41-TV_SIZE', 'song-43'])
  })
})
