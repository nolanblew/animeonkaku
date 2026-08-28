import type { QueueEntry } from './queue'

export interface QueueWindowOptions {
  /** Zero-based item that should remain visible in the window. */
  anchor: number
  /** Number of rows the viewport can display before overscan is applied. */
  viewportSize: number
  /** Rows rendered just outside the viewport to keep small scrolls smooth. */
  overscan?: number
}

export interface QueueWindow {
  readonly entries: readonly QueueEntry[]
  readonly start: number
  readonly endExclusive: number
  readonly total: number
}

/**
 * Selects a bounded queue slice around an anchor without changing entry
 * objects. Queue IDs therefore remain the identity used by row actions even
 * when a long queue is rendered incrementally.
 */
export function windowQueueEntries(entries: readonly QueueEntry[], options: QueueWindowOptions): QueueWindow {
  const total = entries.length
  if (total === 0) return { entries: [], start: 0, endExclusive: 0, total: 0 }

  const viewportSize = positiveInteger(options.viewportSize, 1)
  const overscan = nonNegativeInteger(options.overscan ?? 0)
  const anchor = Math.min(total - 1, Math.max(0, finiteInteger(options.anchor, 0)))
  const maxViewportStart = Math.max(0, total - viewportSize)
  const viewportStart = Math.min(maxViewportStart, Math.max(0, anchor - Math.floor(viewportSize / 2)))
  const start = Math.max(0, viewportStart - overscan)
  const endExclusive = Math.min(total, viewportStart + viewportSize + overscan)

  return { entries: entries.slice(start, endExclusive), start, endExclusive, total }
}

function positiveInteger(value: number, fallback: number): number {
  return Math.max(1, finiteInteger(value, fallback))
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, finiteInteger(value, 0))
}

function finiteInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback
}
