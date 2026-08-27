import { describe, expect, it } from 'vitest'
import { runPlaybackNavigationSoak } from './playbackSoak'

describe('playback and navigation soak', () => {
  it('does not retain media resources after repeated route and queue lifecycles', async () => {
    const result = await runPlaybackNavigationSoak({
      iterations: 120,
      routeSequence: ['/', '/library', '/playlist/1', '/now-playing'],
      queueLength: 8,
    })

    expect(result.iterations).toBe(120)
    expect(result.completedNavigations).toBe(120)
    expect(result.activeMediaListeners).toBe(0)
    expect(result.activeTimers).toBe(0)
    expect(result.activeSubscriptions).toBe(0)
    expect(result.objectUrlsCreated).toBe(result.objectUrlsRevoked)
    expect(result.errors).toEqual([])
  })

  it('keeps retained playback state bounded instead of growing per navigation', async () => {
    const result = await runPlaybackNavigationSoak({
      iterations: 240,
      routeSequence: ['/now-playing', '/playlist/1'],
      queueLength: 12,
    })

    expect(result.maxRetainedQueueEntries).toBeLessThanOrEqual(12)
    expect(result.maxRetainedRouteSnapshots).toBeLessThanOrEqual(1)
    expect(result.heapGrowthBytes).toBeLessThanOrEqual(4 * 1024 * 1024)
  })
})
