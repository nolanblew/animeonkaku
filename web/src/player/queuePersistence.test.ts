import { describe, expect, it } from 'vitest'
import { QueueStore, type QueueItem } from './queue'
import {
  QUEUE_PERSISTENCE_VERSION,
  loadPersistedQueue,
  queuePersistenceKey,
  savePersistedQueue,
} from './queuePersistence'

function item(id: string): QueueItem {
  return { id, title: `Theme ${id}`, audioUrl: `/v1/media/audio/${id}` }
}

describe('user-scoped browser queue persistence', () => {
  it('stores a versioned queue snapshot under the authenticated Kitsu user key', () => {
    const store = new QueueStore()
    store.play([item('one'), item('two')], { contextLabel: 'My anime' })

    savePersistedQueue('kitsu-user-1', store.state)

    expect(queuePersistenceKey('kitsu-user-1')).toBe('anime-ongaku:queue:v1:kitsu-user-1')
    expect(JSON.parse(localStorage.getItem(queuePersistenceKey('kitsu-user-1'))!)).toEqual({
      version: QUEUE_PERSISTENCE_VERSION,
      queue: store.state,
    })
    expect(loadPersistedQueue('kitsu-user-1')).toEqual(store.state)
  })

  it('never restores one authenticated user’s queue for another user', () => {
    const first = new QueueStore()
    first.play([item('first')])
    savePersistedQueue('first-user', first.state)

    expect(loadPersistedQueue('second-user')).toBeUndefined()
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['wrong schema version', JSON.stringify({ version: QUEUE_PERSISTENCE_VERSION + 1, queue: {} })],
    ['invalid queue fields', JSON.stringify({ version: QUEUE_PERSISTENCE_VERSION, queue: { nowPlayingEntries: 'not-an-array' } })],
    ['oversized payload', JSON.stringify({ version: QUEUE_PERSISTENCE_VERSION, queue: { nowPlayingEntries: Array.from({ length: 1_001 }, (_, index) => ({ queueId: index + 1, item: item(String(index)) })) } })],
  ])('ignores %s persisted data', (_label, payload) => {
    localStorage.setItem(queuePersistenceKey('kitsu-user-1'), payload)

    expect(loadPersistedQueue('kitsu-user-1')).toBeUndefined()
  })
})
