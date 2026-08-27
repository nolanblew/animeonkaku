import { describe, expect, it } from 'vitest'
import { createInitialQueueState, QueueStore } from '../player/queue'
import { captureReauthenticationState, restoreReauthenticationState } from './reauthState'

describe('reauthentication state', () => {
  it('preserves the current route, queue context, position, and mode through reconnect', () => {
    const queue = new QueueStore()
    queue.play([
      { id: 'theme-1', title: 'Opening', audioUrl: '/audio/1' },
      { id: 'theme-2', title: 'Ending', audioUrl: '/audio/2' },
    ], { contextLabel: 'Anime 1', startIndex: 1 })

    const snapshot = captureReauthenticationState({
      route: '/playlist/7?track=2#now-playing',
      queueState: queue.state,
      currentTimeSeconds: 83,
      mode: 'FULL_SIZE',
      capturedAtMs: 10_000,
    })
    const restored = restoreReauthenticationState(snapshot, { nowMs: 10_500, maxAgeMs: 60_000 })

    expect(restored).toMatchObject({
      route: '/playlist/7?track=2#now-playing',
      currentTimeSeconds: 83,
      mode: 'FULL_SIZE',
      queueState: queue.state,
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/password|token|cookie|secret/i)
  })

  it('drops stale reconnect snapshots instead of restoring expired playback state', () => {
    const snapshot = captureReauthenticationState({
      route: '/now-playing',
      queueState: createInitialQueueState(),
      currentTimeSeconds: 0,
      mode: 'TV_SIZE',
      capturedAtMs: 1_000,
    })

    expect(restoreReauthenticationState(snapshot, { nowMs: 70_001, maxAgeMs: 60_000 })).toBeUndefined()
  })
})
