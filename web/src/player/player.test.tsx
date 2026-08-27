import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueueStore, type QueueItem } from './queue'
import { MiniPlayerView } from './MiniPlayerView'
import { NowPlayingView } from './NowPlayingView'
import {
  PlayerProvider,
  mapSongToQueueItem,
  mapThemeToQueueItem,
  queueItemAudioUrl,
  resolveAudioUrl,
  usePlayer,
} from './index'
import type { ManagedMediaCache } from '../media/managedCache'

function item(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'theme-1',
    title: 'Opening Theme',
    artist: 'Artist',
    audioUrl: '/v1/media/audio/theme-1',
    videoUrl: 'https://cdn.example/video.webm',
    artworkUrl: 'https://cdn.example/art.jpg',
    ...overrides,
  }
}

function Harness() {
  const player = usePlayer()
  return (
    <div>
      <output data-testid="current">{player.currentEntry?.queueId ?? 'none'}</output>
      <output data-testid="mode">{player.mode}</output>
      <output data-testid="status">{player.error ?? (player.isPlaying ? 'playing' : 'paused')}</output>
      <button type="button" onClick={() => void player.play()}>play</button>
      <button type="button" onClick={() => player.pause()}>pause</button>
      <button type="button" onClick={() => void player.next()}>next</button>
      <button type="button" onClick={() => player.setMode('VIDEO')}>video</button>
      <button type="button" onClick={() => player.seek(12)}>seek</button>
      <NowPlayingView />
      <MiniPlayerView />
    </div>
  )
}

function renderPlayer(store = new QueueStore(), options: Record<string, unknown> = {}) {
  return render(
    <PlayerProvider queueStore={store} {...options}>
      <Harness />
    </PlayerProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('queue item mappings and protected media URLs', () => {
  it('maps a theme to distinct TV/full/video sources', () => {
    const mapped = mapThemeToQueueItem({
      id: 4,
      title: 'Theme',
      themeType: 'OP',
      artists: [{ name: 'Band', asCharacter: null, alias: null }],
      audioUrl: '/v1/media/audio/4',
      videoUrl: 'https://cdn.example/4.webm',
      mediaModes: {
        tvSize: { url: '/v1/media/audio/4', durationSeconds: 90, fileSize: null },
        fullSize: { songId: 8, url: '/v1/media/audio/song-8', durationSeconds: 240, fileSize: null, sourceReleaseId: null },
        video: { url: 'https://cdn.example/4.webm', mimeType: 'video/webm', spoiler: false, nsfw: false, entryVersion: 1 },
      },
    } as never)

    expect(mapped.itemType).toBe('THEME')
    expect(mapped.tvAudioUrl).toBe('/v1/media/audio/4')
    expect(mapped.fullAudioUrl).toBe('/v1/media/audio/song-8')
    expect(mapped.videoUrl).toBe('https://cdn.example/4.webm')
  })

  it('maps a full song as a SONG item and resolves protected audio through /api', () => {
    const mapped = mapSongToQueueItem({
      id: 8,
      title: 'Full Song',
      titleEnglish: null,
      titleRomaji: null,
      titleJapanese: null,
      artistCredit: 'Band',
      artistNames: [],
      durationSeconds: 240,
      audioUrl: '/v1/media/audio/song-8',
      fileSize: null,
      discNumber: 1,
      trackNumber: 1,
      displayOrder: 1,
    })
    expect(mapped.itemType).toBe('SONG')
    expect(mapped.audioUrl).toBe('/v1/media/audio/song-8')
    expect(queueItemAudioUrl(mapped, 'TV_SIZE')).toBeUndefined()
    expect(queueItemAudioUrl(mapped, 'FULL_SIZE')).toBe('/v1/media/audio/song-8')
    expect(resolveAudioUrl(mapped.audioUrl!)).toBe('/api/v1/media/audio/song-8')
    expect(resolveAudioUrl('https://cdn.example/song.m4a')).toBe('https://cdn.example/song.m4a')
  })
})

describe('PlayerProvider', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('renders real media elements and preserves occurrence identity for duplicate songs', async () => {
    const store = new QueueStore()
    store.play([item()])
    store.addToQueue([item()])
    renderPlayer(store)

    expect(screen.getByTestId('player-audio').tagName).toBe('AUDIO')
    expect(screen.getByTestId('player-video').tagName).toBe('VIDEO')
    expect(screen.getByTestId('now-playing-video-surface')).toContainElement(screen.getByTestId('player-video'))
    expect(screen.getByTestId('current')).toHaveTextContent('1')
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /^video$/i })) })
    expect(screen.getByTestId('now-playing-video-surface')).toContainElement(screen.getByTestId('player-video'))
    expect(screen.getByTestId('player-video')).toHaveClass('player-video--visible')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
    expect(screen.getByTestId('current')).toHaveTextContent('2')
  })

  it('binds media events to the live queue even when the queue starts empty', async () => {
    const store = new QueueStore()
    renderPlayer(store)
    await act(async () => { store.play([item({ id: 'first' }), item({ id: 'second', title: 'Second Theme' })]) })
    const audio = screen.getByTestId('player-audio')
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/v1/media/audio/theme-1'))
    await act(async () => { fireEvent.ended(audio) })
    expect(screen.getByTestId('current')).toHaveTextContent('2')
  })

  it('uses the video source as the active source when VIDEO mode is selected', async () => {
    const store = new QueueStore()
    store.play([item({ audioUrl: undefined, videoUrl: 'https://cdn.example/only.webm' })])
    function ModeHarness() {
      const player = usePlayer()
      return <button type="button" onClick={() => player.setMode('VIDEO')}>{player.activeSourceUrl}</button>
    }
    render(<PlayerProvider queueStore={store}><ModeHarness /></PlayerProvider>)
    await act(async () => { fireEvent.click(screen.getByRole('button')) })
    expect(screen.getByRole('button')).toHaveTextContent('https://cdn.example/only.webm')
    expect(screen.getByTestId('player-video')).toHaveAttribute('src', 'https://cdn.example/only.webm')
  })

  it('rebinds media events after the video element moves into the now-playing surface', async () => {
    const store = new QueueStore()
    store.play([item({ id: 'first' }), item({ id: 'second', title: 'Second Theme' })])
    renderPlayer(store)

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /^video$/i })) })
    const video = screen.getByTestId('player-video')
    expect(screen.getByTestId('now-playing-video-surface')).toContainElement(video)

    await act(async () => { fireEvent.ended(video) })
    expect(screen.getByTestId('current')).toHaveTextContent('2')
  })

  it('fullscreens the complete video stage so playback controls remain available', async () => {
    const requestFullscreen = vi.fn(function (this: HTMLElement) { return Promise.resolve(this) })
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'requestFullscreen')
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
    try {
      const store = new QueueStore()
      store.play([item()])
      renderPlayer(store)

      await userEvent.click(screen.getByRole('tab', { name: /^video$/i }))
      await userEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }))

      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen.mock.instances[0]).toHaveClass('player-now-playing__stage')
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen')
    }
  })

  it('registers OS media-session metadata, actions, and a position state', async () => {
    const handlers = new Map<string, ((details?: unknown) => void) | null>()
    const session = {
      metadata: null as unknown,
      playbackState: 'none' as const,
      setActionHandler: vi.fn((action: string, handler: ((details?: unknown) => void) | null) => { handlers.set(action, handler) }),
      setPositionState: vi.fn(),
    }
    const previousDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaSession')
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session })
    try {
      const store = new QueueStore()
      store.play([item({ itemType: 'THEME', animeTitle: 'Signal Breaker', themeType: 'ED1' })])
      renderPlayer(store)
      await waitFor(() => expect(handlers.get('nexttrack')).toEqual(expect.any(Function)))
      expect(session.metadata).toMatchObject({ title: 'Signal Breaker · ED 1', artist: 'Opening Theme · Artist' })
      const audio = screen.getByTestId('player-audio')
      Object.defineProperty(audio, 'duration', { configurable: true, value: 100 })
      Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 12 })
      fireEvent.timeUpdate(audio)
      expect(session.setPositionState).toHaveBeenCalled()
    } finally {
      if (previousDescriptor) Object.defineProperty(navigator, 'mediaSession', previousDescriptor)
      else Reflect.deleteProperty(navigator, 'mediaSession')
    }
  })

  it('consumes a matching managed cache response and revokes its object URL', async () => {
    const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    const createObjectURL = vi.fn(() => 'blob:cached-audio')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    try {
      const store = new QueueStore()
      store.play([item()])
      const cache = {
        reconcile: vi.fn(() => Promise.resolve()),
        matchAudio: vi.fn(async () => new Response('audio', { status: 200 })),
      } as unknown as ManagedMediaCache
      const rendered = renderPlayer(store, { mediaCache: cache })
      await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', 'blob:cached-audio'))
      expect(createObjectURL).toHaveBeenCalled()
      rendered.unmount()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-audio')
    } finally {
      if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else Reflect.deleteProperty(URL, 'createObjectURL')
      if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('reports rejected autoplay as recoverable player error', async () => {
    const play = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
    const store = new QueueStore()
    store.play([item()])
    renderPlayer(store)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/notallowederror|could not start/i))
  })

  it('records one play event per queue occurrence without recounting resume', async () => {
    const post = vi.fn(() => Promise.resolve({ accepted: 1 }))
    const api = {
      url: (path: string) => `/api${path}`,
      post,
    }
    const store = new QueueStore()
    store.play([mapThemeToQueueItem({
      id: 44,
      title: 'Counted Opening',
      themeType: 'OP',
      audioUrl: '/v1/media/audio/44',
      artists: [],
    } as never)])
    renderPlayer(store, { api })
    const audio = screen.getByTestId('player-audio')
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/v1/media/audio/44'))

    fireEvent.play(audio)
    fireEvent.pause(audio)
    fireEvent.play(audio)

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/v1/plays', [expect.objectContaining({
      clientEventId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      itemType: 'THEME',
      itemId: 44,
      actualMode: 'TV_SIZE',
      playedAt: expect.any(Number),
    })])
  })

  it('switches TV to video while retaining position and restarts when switching to full size', async () => {
    const store = new QueueStore()
    store.play([item({ fullAudioUrl: '/v1/media/audio/full-1' })])
    renderPlayer(store)
    const audio = screen.getByTestId('player-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 42 })

    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /^video$/i })) })
    expect(screen.getByTestId('mode')).toHaveTextContent('VIDEO')
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /full size/i })) })
    expect(screen.getByTestId('mode')).toHaveTextContent('FULL_SIZE')
    expect((audio as HTMLAudioElement).currentTime).toBe(0)
  })

  it('seeks and exposes accessible responsive controls in both views', async () => {
    const store = new QueueStore()
    store.play([item()])
    renderPlayer(store)
    const audio = screen.getByTestId('player-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^seek$/i })) })
    expect(audio.currentTime).toBe(12)
    expect(screen.getByRole('region', { name: /now playing/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /mini player/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /pause|play/i }).length).toBeGreaterThan(0)
  })
})

describe('media cache reconciliation', () => {
  it('passes exactly the next three audio URLs and never a video URL', async () => {
    const reconcile = vi.fn(() => Promise.resolve())
    const cache = { reconcile } as unknown as ManagedMediaCache
    const store = new QueueStore()
    store.play([item({ id: 'a', artworkUrl: 'art-a' }), item({ id: 'b', audioUrl: '/v1/b', videoUrl: 'video-b' }), item({ id: 'c', audioUrl: '/v1/c' }), item({ id: 'd', audioUrl: '/v1/d' }), item({ id: 'e', audioUrl: '/v1/e' })])
    renderPlayer(store, { mediaCache: cache })
    await waitFor(() => expect(reconcile).toHaveBeenCalled())
    const calls = reconcile.mock.calls as unknown as Array<[{ nextAudioUrls: string[]; imageUrls: string[] }]>
    const last = calls[calls.length - 1][0]
    expect(last.nextAudioUrls).toEqual(['/api/v1/b', '/api/v1/c', '/api/v1/d'])
    expect(last.nextAudioUrls).not.toContain('video-b')
    expect(last.imageUrls).toEqual(['/api/art-a', 'https://cdn.example/art.jpg', 'https://cdn.example/art.jpg', 'https://cdn.example/art.jpg'])
  })

  it('prefetches current plus next-three artwork and invalidates audio outside the next-three window', async () => {
    const reconcile = vi.fn(() => Promise.resolve())
    const cache = { reconcile } as unknown as ManagedMediaCache
    const store = new QueueStore()
    store.play([
      item({ id: 'a', audioUrl: '/v1/a', artworkUrl: '/art-a' }),
      item({ id: 'b', audioUrl: '/v1/b', artworkUrl: '/art-b' }),
      item({ id: 'c', audioUrl: '/v1/c', artworkUrl: '/art-c' }),
      item({ id: 'd', audioUrl: '/v1/d', artworkUrl: '/art-d' }),
      item({ id: 'e', audioUrl: '/v1/e', artworkUrl: '/art-e' }),
    ])
    renderPlayer(store, { mediaCache: cache })

    await waitFor(() => {
      const calls = reconcile.mock.calls as unknown as Array<[{ nextAudioUrls: string[]; imageUrls: string[] }]>
      const latest = calls[calls.length - 1]?.[0]
      expect(latest?.nextAudioUrls).toEqual(['/api/v1/b', '/api/v1/c', '/api/v1/d'])
      expect(latest?.imageUrls).toEqual(['/api/art-a', '/api/art-b', '/api/art-c', '/api/art-d'])
    })

    await act(async () => { store.skipTo(2) })
    await waitFor(() => {
      const calls = reconcile.mock.calls as unknown as Array<[{ nextAudioUrls: string[]; imageUrls: string[] }]>
      const latest = calls[calls.length - 1]?.[0]
      expect(latest?.nextAudioUrls).toEqual(['/api/v1/d', '/api/v1/e'])
      expect(latest?.nextAudioUrls).not.toContain('/api/v1/b')
      expect(latest?.imageUrls).toEqual(['/api/art-c', '/api/art-d', '/api/art-e'])
    })
  })
})
