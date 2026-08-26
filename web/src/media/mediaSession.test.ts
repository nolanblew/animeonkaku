import { describe, expect, it, vi } from 'vitest'
import { BrowserMediaSession, type MediaElementPort, type MediaSessionPort } from './mediaSession'

function media(): MediaElementPort {
  return {
    currentTime: 30,
    duration: 120,
    playbackRate: 1,
    paused: true,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  }
}

function session(): MediaSessionPort & { handlers: Map<string, ((details?: never) => void) | null> } {
  const handlers = new Map<string, ((details?: never) => void) | null>()
  return {
    handlers,
    metadata: null,
    playbackState: 'none',
    setActionHandler: vi.fn((action, handler) => handlers.set(action, handler as (details?: never) => void)),
    setPositionState: vi.fn(),
  }
}

describe('BrowserMediaSession', () => {
  it('connects OS play, pause, seek, previous, and next controls', async () => {
    const element = media()
    const port = session()
    const previous = vi.fn()
    const next = vi.fn()
    const bridge = new BrowserMediaSession(element, port, { previous, next })

    bridge.start()
    await port.handlers.get('play')?.()
    port.handlers.get('pause')?.()
    port.handlers.get('seekbackward')?.({ seekOffset: 10 } as never)
    port.handlers.get('seekforward')?.({ seekOffset: 20 } as never)
    port.handlers.get('seekto')?.({ seekTime: 75 } as never)
    port.handlers.get('previoustrack')?.()
    port.handlers.get('nexttrack')?.()

    expect(element.play).toHaveBeenCalled()
    expect(element.pause).toHaveBeenCalled()
    expect(element.currentTime).toBe(75)
    expect(previous).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledOnce()
  })

  it('publishes sanitized metadata, playback state, and finite position state', () => {
    const element = media()
    const port = session()
    const bridge = new BrowserMediaSession(element, port)

    bridge.updateMetadata({ title: 'Theme', artist: 'Artist', album: 'Anime', artworkUrl: '/art.jpg' })
    bridge.syncState('playing')

    expect(port.metadata).toEqual({
      title: 'Theme',
      artist: 'Artist',
      album: 'Anime',
      artwork: [{ src: '/art.jpg' }],
    })
    expect(port.playbackState).toBe('playing')
    expect(port.setPositionState).toHaveBeenCalledWith({ duration: 120, playbackRate: 1, position: 30 })
  })

  it('removes every registered handler when disposed', () => {
    const port = session()
    const bridge = new BrowserMediaSession(media(), port)
    bridge.start()
    bridge.dispose()

    expect([...port.handlers.values()].every((handler) => handler === null)).toBe(true)
  })
})
