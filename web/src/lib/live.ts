import { apiClient } from './api'
import type { ChangesResponse } from './library'

export type LiveChangeCategory = 'library' | 'playlist' | 'profile'
export interface LiveChangeNotification {
  cursor: number
  categories: LiveChangeCategory[]
  sourceCursor: number | null
}

export interface LiveReadyNotification {
  cursor: number
  sourceCursor: number | null
  resync?: boolean
  since?: number | null
}

interface EventSourceLike {
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  removeEventListener(type: string, listener: (event: MessageEvent) => void): void
  close(): void
}

export interface LibraryLiveClientOptions {
  url?: string
  changesUrl?: string
  initialCursor?: number | null
  eventSourceFactory?: (url: string, options: EventSourceInit) => EventSourceLike
  fetchChanges?: (since: number | null) => Promise<ChangesResponse>
  onChange: (notification: LiveChangeNotification) => void
  onChanges?: (changes: ChangesResponse) => void
  onReady?: (notification: LiveReadyNotification) => void
  onUnauthorized?: () => void
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  fallbackPollMs?: number
}

const LIVE_CATEGORIES: readonly LiveChangeCategory[] = ['library', 'playlist', 'profile']

/**
 * Cookie-authenticated SSE with bounded reconnect and a slow periodic
 * delta-polling safety net. It owns all timers and EventSource listeners so a logout or
 * component unmount can synchronously tear the connection down.
 */
export class LibraryLiveClient {
  private readonly url: string
  private readonly changesUrl: string
  private readonly eventSourceFactory: (url: string, options: EventSourceInit) => EventSourceLike
  private readonly fetchChanges: (since: number | null) => Promise<ChangesResponse>
  private readonly onChange: (notification: LiveChangeNotification) => void
  private readonly onChanges?: (changes: ChangesResponse) => void
  private readonly onReady?: (notification: LiveReadyNotification) => void
  private readonly onUnauthorized?: () => void
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly fallbackPollMs: number
  private source: EventSourceLike | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private stopped = true
  private reconnectAttempt = 0
  private lastEventCursor: number | null = null
  private sourceCursor: number | null = null

  constructor(options: LibraryLiveClientOptions) {
    this.url = options.url ?? apiClient.url('/v1/library/live')
    // Keep the fetch path API-relative: ApiClient adds the configured `/api`
    // boundary. The SSE URL above is resolved to an absolute browser URL.
    this.changesUrl = options.changesUrl ?? '/v1/changes'
    this.eventSourceFactory = options.eventSourceFactory ?? defaultEventSourceFactory
    this.fetchChanges = options.fetchChanges ?? ((since) => apiClient.get<ChangesResponse>(withSince(this.changesUrl, since)))
    this.onChange = options.onChange
    this.onChanges = options.onChanges
    this.onReady = options.onReady
    this.onUnauthorized = options.onUnauthorized
    this.reconnectBaseMs = boundDelay(options.reconnectBaseMs ?? 500, 0, 30_000)
    this.reconnectMaxMs = boundDelay(options.reconnectMaxMs ?? 30_000, this.reconnectBaseMs, 30_000)
    this.fallbackPollMs = boundDelay(options.fallbackPollMs ?? 5 * 60_000, 1, 60 * 60_000)
    this.sourceCursor = options.initialCursor ?? null
  }

  start(initialCursor = this.sourceCursor): void {
    this.stop()
    this.stopped = false
    this.sourceCursor = initialCursor ?? null
    // `initialCursor` is the `/v1/changes` watermark, not the hub's private
    // SSE cursor. Only a cursor received from an SSE event is safe to send as
    // the live route's `?cursor=` on reconnect.
    this.lastEventCursor = null
    this.reconnectAttempt = 0
    this.connect()
    this.startFallbackPolling()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.source !== null) {
      this.source.removeEventListener('ready', this.handleReady)
      this.source.removeEventListener('change', this.handleChange)
      this.source.removeEventListener('error', this.handleEventError)
      this.source.onopen = null
      this.source.onerror = null
      this.source.close()
      this.source = null
    }
  }

  private connect(): void {
    if (this.stopped || this.source !== null) return
    const url = withCursor(this.url, this.lastEventCursor)
    try {
      const source = this.eventSourceFactory(url, { withCredentials: true })
      this.source = source
      source.addEventListener('ready', this.handleReady)
      source.addEventListener('change', this.handleChange)
      source.addEventListener('error', this.handleEventError)
      source.onopen = this.handleOpen
      source.onerror = this.handleError
    } catch {
      this.handleError()
    }
  }

  private readonly handleOpen = (_event?: Event): void => {
    this.reconnectAttempt = 0
  }

  private readonly handleReady = (event: MessageEvent): void => {
    const notification = parseReady(event.data)
    if (!notification) return
    this.lastEventCursor = maxCursor(this.lastEventCursor, notification.cursor)
    this.sourceCursor = maxCursor(this.sourceCursor, notification.sourceCursor)
    this.onReady?.(notification)
    if (notification.resync) {
      this.onChange({
        cursor: notification.cursor,
        sourceCursor: notification.since ?? notification.sourceCursor,
        categories: [...LIVE_CATEGORIES],
      })
    }
  }

  private readonly handleChange = (event: MessageEvent): void => {
    const notification = parseChange(event.data)
    if (!notification) return
    this.lastEventCursor = maxCursor(this.lastEventCursor, notification.cursor)
    this.sourceCursor = maxCursor(this.sourceCursor, notification.sourceCursor)
    this.onChange(notification)
  }

  private readonly handleEventError = (): void => this.handleError()

  private readonly handleError = (_event?: Event): void => {
    if (this.stopped) return
    if (this.source !== null) {
      this.source.removeEventListener('ready', this.handleReady)
      this.source.removeEventListener('change', this.handleChange)
      this.source.removeEventListener('error', this.handleEventError)
      this.source.onopen = null
      this.source.onerror = null
      this.source.close()
      this.source = null
    }
    this.startFallbackPolling()
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startFallbackPolling(): void {
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => { void this.pollOnce() }, this.fallbackPollMs)
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return
    try {
      const changes = await this.fetchChanges(this.sourceCursor)
      if (this.stopped) return
      this.sourceCursor = maxCursor(this.sourceCursor, changes.serverTime)
      this.onChanges?.(changes)
    } catch (error) {
      if (isUnauthorized(error)) this.onUnauthorized?.()
      // The next bounded poll or a reconnect will retry. ApiClient already
      // converts transport and HTTP failures into a sanitized ApiError.
    }
  }
}

function isUnauthorized(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: unknown }).status === 401
}

function defaultEventSourceFactory(url: string, options: EventSourceInit): EventSourceLike {
  if (typeof EventSource === 'undefined') throw new Error('EventSource is unavailable in this environment.')
  return new EventSource(url, options)
}

function withCursor(url: string, cursor: number | null): string {
  return cursor === null ? url : `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
}

function withSince(url: string, cursor: number | null): string {
  return cursor === null ? url : `${url}${url.includes('?') ? '&' : '?'}since=${encodeURIComponent(cursor)}`
}

function parseReady(value: unknown): LiveReadyNotification | null {
  const record = parseRecord(value)
  if (!record || !isSafeNonNegativeInteger(record.cursor)) return null
  return {
    cursor: record.cursor,
    sourceCursor: isSafeNonNegativeInteger(record.sourceCursor) ? record.sourceCursor : null,
    ...(typeof record.resync === 'boolean' ? { resync: record.resync } : {}),
    ...(record.since === null || isSafeNonNegativeInteger(record.since) ? { since: record.since as number | null } : {}),
  }
}

function parseChange(value: unknown): LiveChangeNotification | null {
  const record = parseRecord(value)
  if (!record || !isSafeNonNegativeInteger(record.cursor) || !Array.isArray(record.categories)) return null
  const categories = record.categories.filter((value): value is LiveChangeCategory => LIVE_CATEGORIES.includes(value as LiveChangeCategory))
  if (categories.length === 0) return null
  return {
    cursor: record.cursor,
    categories: [...new Set(categories)],
    sourceCursor: isSafeNonNegativeInteger(record.sourceCursor) ? record.sourceCursor : null,
  }
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function maxCursor(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function boundDelay(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.trunc(value))) : minimum
}
