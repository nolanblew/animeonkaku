import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryLiveClient, type LiveChangeNotification } from './live'
import { apiClient } from './api'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>()
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string, readonly options?: EventSourceInit) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }))
    }
  }

  fail() {
    this.onerror?.()
  }
}

afterEach(() => {
  vi.useRealTimers()
  FakeEventSource.instances = []
})

describe('LibraryLiveClient', () => {
  it('opens EventSource with credentials and forwards category notifications', () => {
    const onChange = vi.fn<(change: LiveChangeNotification) => void>()
    const onReady = vi.fn()
    const client = new LibraryLiveClient({ eventSourceFactory: (url, options) => new FakeEventSource(url, options), onChange, onReady })

    client.start(42)
    const source = FakeEventSource.instances[0]!
    source.emit('ready', { cursor: 6, sourceCursor: 88, resync: true, since: 80 })
    source.emit('change', { cursor: 7, sourceCursor: 88, categories: ['library'] })
    source.emit('change', { cursor: 8, sourceCursor: 89, categories: ['unknown'] })

    expect(source.url).toBe('/api/v1/library/live')
    expect(source.options).toEqual({ withCredentials: true })
    expect(onReady).toHaveBeenCalledWith({ cursor: 6, sourceCursor: 88, resync: true, since: 80 })
    expect(onChange).toHaveBeenCalledWith({ cursor: 7, sourceCursor: 88, categories: ['library'] })
    expect(onChange).toHaveBeenCalledWith({ cursor: 6, sourceCursor: 80, categories: ['library', 'playlist', 'profile'] })
    client.stop()
  })

  it('reconnects with bounded backoff, polls deltas while disconnected, and cleans every timer/listener on stop', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const fetchChanges = vi.fn().mockResolvedValue({ serverTime: 99, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] })
    const client = new LibraryLiveClient({
      eventSourceFactory: (url, options) => new FakeEventSource(url, options),
      fetchChanges,
      onChange,
      reconnectBaseMs: 10,
      reconnectMaxMs: 20,
      fallbackPollMs: 50,
    })

    client.start(40)
    const first = FakeEventSource.instances[0]!
    first.fail()
    vi.advanceTimersByTime(10)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(50)
    expect(fetchChanges).toHaveBeenCalledWith(40)

    FakeEventSource.instances[1]!.onopen?.()
    FakeEventSource.instances[1]!.emit('error', null)
    vi.advanceTimersByTime(20)
    expect(FakeEventSource.instances).toHaveLength(3)

    client.stop()
    const count = FakeEventSource.instances.length
    vi.advanceTimersByTime(1000)
    expect(FakeEventSource.instances).toHaveLength(count)
    expect(FakeEventSource.instances.at(-1)?.closed).toBe(true)
  })

  it('uses the configured API boundary for the default fallback changes request', () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(apiClient, 'get').mockResolvedValue({ serverTime: 10, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] })
    const client = new LibraryLiveClient({
      eventSourceFactory: (url, options) => new FakeEventSource(url, options),
      onChange: vi.fn(),
      fallbackPollMs: 10,
    })
    client.start(9)
    FakeEventSource.instances[0]!.fail()
    vi.advanceTimersByTime(10)

    expect(fetchMock).toHaveBeenCalledWith('/v1/changes?since=9')
    client.stop()
  })
})
