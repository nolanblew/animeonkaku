export interface MediaElementPort {
  currentTime: number
  duration: number
  playbackRate: number
  paused: boolean
  play(): Promise<void>
  pause(): void
}

export interface MediaActionDetails {
  seekOffset?: number
  seekTime?: number
  fastSeek?: boolean
}

export type BrowserMediaAction =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto'
  | 'previoustrack'
  | 'nexttrack'

export interface MediaSessionPort {
  metadata: unknown
  playbackState: 'none' | 'paused' | 'playing'
  setActionHandler(action: BrowserMediaAction, handler: ((details: MediaActionDetails) => void) | null): void
  setPositionState(state?: { duration: number; playbackRate: number; position: number }): void
}

export interface MediaSessionTrack {
  title: string
  artist?: string | null
  album?: string | null
  artworkUrl?: string | null
}

export interface BrowserMediaSessionActions {
  previous?: () => void
  next?: () => void
}

const ACTIONS: readonly BrowserMediaAction[] = [
  'play',
  'pause',
  'seekbackward',
  'seekforward',
  'seekto',
  'previoustrack',
  'nexttrack',
]

/** Small adapter around the browser Media Session API; it owns no queue state. */
export class BrowserMediaSession {
  private started = false

  constructor(
    private readonly media: MediaElementPort,
    private readonly session: MediaSessionPort,
    private readonly actions: BrowserMediaSessionActions = {},
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.setHandler('play', () => { void this.media.play() })
    this.setHandler('pause', () => this.media.pause())
    this.setHandler('seekbackward', (details) => this.seekBy(-(finiteOr(details.seekOffset, 10))))
    this.setHandler('seekforward', (details) => this.seekBy(finiteOr(details.seekOffset, 10)))
    this.setHandler('seekto', (details) => this.seekTo(details.seekTime))
    this.setHandler('previoustrack', () => this.actions.previous?.())
    this.setHandler('nexttrack', () => this.actions.next?.())
  }

  updateMetadata(track: MediaSessionTrack): void {
    const metadata = {
      title: boundedText(track.title, 'Unknown track'),
      artist: boundedText(track.artist, ''),
      album: boundedText(track.album, ''),
      artwork: track.artworkUrl?.trim() ? [{ src: track.artworkUrl.trim() }] : [],
    }
    const Metadata = globalThis.MediaMetadata
    this.session.metadata = typeof Metadata === 'function' ? new Metadata(metadata) : metadata
  }

  syncState(state: 'none' | 'paused' | 'playing'): void {
    this.session.playbackState = state
    const duration = this.media.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const playbackRate = Number.isFinite(this.media.playbackRate) && this.media.playbackRate > 0
      ? this.media.playbackRate
      : 1
    const position = Math.min(duration, Math.max(0, finiteOr(this.media.currentTime, 0)))
    try {
      this.session.setPositionState({ duration, playbackRate, position })
    } catch {
      // Some browsers expose MediaSession but reject position state for
      // transient metadata/duration combinations. Playback remains usable.
    }
  }

  dispose(): void {
    for (const action of ACTIONS) this.setHandler(action, null)
    this.started = false
    this.session.playbackState = 'none'
  }

  private seekBy(offset: number): void {
    this.seekTo(this.media.currentTime + offset)
  }

  private seekTo(value: number | undefined): void {
    if (!Number.isFinite(value)) return
    const duration = this.media.duration
    this.media.currentTime = Number.isFinite(duration) && duration > 0
      ? Math.min(duration, Math.max(0, value!))
      : Math.max(0, value!)
  }

  private setHandler(action: BrowserMediaAction, handler: ((details: MediaActionDetails) => void) | null): void {
    try {
      this.session.setActionHandler(action, handler)
    } catch {
      // Unsupported action names differ by browser/OS. Other handlers remain.
    }
  }
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boundedText(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback
  return normalized.slice(0, 300)
}
