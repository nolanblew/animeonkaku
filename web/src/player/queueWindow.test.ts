import { describe, expect, it } from 'vitest'
import { windowQueueEntries, type QueueWindow } from './queueWindow'
import type { QueueEntry } from './queue'

function entry(queueId: number): QueueEntry {
  return { queueId, item: { id: queueId, title: `Queue item ${queueId}` } }
}

describe('queue windowing contract', () => {
  it('returns only a bounded, stable-identity window for a long queue', () => {
    const entries = Array.from({ length: 5_000 }, (_, index) => entry(index + 1))
    const window: QueueWindow = windowQueueEntries(entries, { anchor: 2_500, viewportSize: 40, overscan: 8 })

    expect(window.total).toBe(5_000)
    expect(window.entries.length).toBeLessThanOrEqual(56)
    expect(window.start).toBeLessThanOrEqual(2_500)
    expect(window.endExclusive).toBeGreaterThan(2_500)
    expect(window.entries.map((item) => item.queueId)).toEqual(
      Array.from({ length: window.entries.length }, (_, index) => window.start + index + 1),
    )
  })

  it('clamps the window at both ends without losing queue-entry identity', () => {
    const entries = Array.from({ length: 100 }, (_, index) => entry(index + 1))

    const first = windowQueueEntries(entries, { anchor: 0, viewportSize: 20, overscan: 5 })
    expect(first.start).toBe(0)
    expect(first.entries[0]?.queueId).toBe(1)

    const last = windowQueueEntries(entries, { anchor: 99, viewportSize: 20, overscan: 5 })
    expect(last.endExclusive).toBe(100)
    expect(last.entries.at(-1)?.queueId).toBe(100)
  })
})
