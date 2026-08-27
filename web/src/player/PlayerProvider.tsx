import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { apiClient, type ApiClient } from '../lib/api'
import { BrowserMediaSession, type MediaSessionPort } from '../media/mediaSession'
import { browserCacheStorage, ManagedMediaCache } from '../media/managedCache'
import { modeStartTime, type PlaybackMode } from '../media/modeSwitch'
import {
  currentQueueEntry,
  QueueStore,
  type PlayOptions,
  type QueueEntry,
  type QueueItem,
  type QueueState,
  type RepeatMode,
} from './queue'
import {
  mapSongToQueueItem,
  mapThemeToQueueItem,
  queueItemAudioUrl,
  queueItemDurationMs,
  queueItemVideoUrl,
  type PlayerQueueItem,
  type ThemeQueueItemOptions,
} from './mapping'
import { VideoSafetyDialog } from './VideoSafetyDialog'
import type { LibraryThemeDto, MusicTrackDto } from '../lib/library'
import {
  emptyQueuePreferenceSnapshot,
  isQueueEntryAllowedByPreference,
  type QueuePreferenceSnapshot,
} from './preferenceQueue'
import { loadPersistedQueue, savePersistedQueue } from './queuePersistence'

export interface PlayerState {
  readonly queueState: QueueState
  readonly currentEntry?: QueueEntry
  readonly currentItem?: QueueItem
  readonly mode: PlaybackMode
  readonly isPlaying: boolean
  readonly isLoading: boolean
  readonly isEnded: boolean
  readonly currentTime: number
  readonly duration: number
  readonly error: string | null
  readonly tvSizeAvailable: boolean
  readonly fullSizeAvailable: boolean
  readonly videoAvailable: boolean
  readonly activeSourceUrl?: string
}

export interface PlayThemeOptions extends PlayOptions, ThemeQueueItemOptions {
  autoPlay?: boolean
}

export interface PlayQueueItemOptions extends PlayOptions {
  mode?: PlaybackMode
  autoPlay?: boolean
}

export interface PlayerContextValue extends PlayerState {
  readonly queue: QueueStore
  readonly queueStore: QueueStore
  readonly audioElement: HTMLAudioElement | null
  readonly videoElement: HTMLVideoElement | null
  readonly registerVideoSurface: (element: HTMLElement | null) => void
  playTheme(theme: LibraryThemeDto, options?: PlayThemeOptions): void
  playSong(song: MusicTrackDto, options?: PlayQueueItemOptions & ThemeQueueItemOptions): void
  playItem(item: QueueItem, options?: PlayQueueItemOptions): void
  playItems(items: readonly QueueItem[], options?: PlayQueueItemOptions): void
  play(): Promise<void>
  pause(): void
  togglePlay(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  seek(seconds: number): void
  setMode(mode: PlaybackMode): void
  toggleShuffle(): void
  setShuffle(shuffled: boolean): void
  cycleRepeat(): RepeatMode
  setRepeat(mode: RepeatMode): void
  skipTo(index: number): void
  unskipEntry(queueId: number): void
  requestFullscreen(): Promise<void>
}

export interface PlayerProviderProps {
  children: ReactNode
  queueStore?: QueueStore
  /** Alias kept for callers that name the injected store explicitly. */
  store?: QueueStore
  mediaCache?: ManagedMediaCache
  api?: Pick<ApiClient, 'url'> & Partial<Pick<ApiClient, 'post'>>
  initialMode?: PlaybackMode
  /** Authenticated Kitsu identity used to scope browser queue restoration. */
  persistenceUserId?: string
  /** Synchronized likes/dislikes used to keep automatic playback in parity with Android. */
  preferenceSnapshot?: QueuePreferenceSnapshot
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function PlayerProvider({
  children,
  queueStore: providedQueue,
  store,
  mediaCache,
  api = apiClient,
  initialMode = 'TV_SIZE',
  persistenceUserId,
  preferenceSnapshot = emptyQueuePreferenceSnapshot,
}: PlayerProviderProps) {
  const queue = useMemo(() => providedQueue ?? store ?? new QueueStore(
    persistenceUserId ? loadPersistedQueue(persistenceUserId) : undefined,
  ), [providedQueue, persistenceUserId, store])
  const subscribe = useMemo(() => queue.subscribe.bind(queue), [queue])
  const queueState = useSyncExternalStore(subscribe, () => queue.state, () => queue.state)
  const ownedMediaCache = useMemo(() => mediaCache ?? createBrowserMediaCache(), [mediaCache])
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoSurface, setVideoSurface] = useState<HTMLElement | null>(null)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null)
  const [videoConfirmation, setVideoConfirmation] = useState<VideoConfirmationRequest | null>(null)
  const confirmedVideoKeysRef = useRef(new Set<string>())
  const modeRef = useRef<PlaybackMode>(initialMode)
  const activeMediaRef = useRef<HTMLMediaElement | null>(null)
  const mediaSessionRef = useRef<BrowserMediaSession | null>(null)
  const sourceReadyRef = useRef<Promise<void>>(Promise.resolve())
  const cachedObjectUrlRef = useRef<string | null>(null)
  const preservedVideoRef = useRef<{ time: number; wasPlaying: boolean } | null>(null)
  const sourceKeyRef = useRef('')
  const pendingSeekRef = useRef<{ from: PlaybackMode; to: PlaybackMode; time: number; queueId?: number } | null>(null)
  const shouldAutoplayRef = useRef(false)
  const callbacksRef = useRef<MediaCallbacks>({})
  const recordedPlayQueueIdsRef = useRef(new Set<number>())
  const [mode, setModeState] = useState<PlaybackMode>(initialMode)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isEnded, setIsEnded] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying

  const registerVideoSurface = useCallback((element: HTMLElement | null) => {
    setVideoSurface(element)
  }, [])

  const assignVideoElement = useCallback((element: HTMLVideoElement | null) => {
    if (!element && videoRef.current) {
      preservedVideoRef.current = {
        time: finiteMediaNumber(videoRef.current.currentTime),
        wasPlaying: isPlayingRef.current || !videoRef.current.paused,
      }
    }
    videoRef.current = element
    setVideoElement(element)
  }, [])

  const currentEntry = currentQueueEntry(queueState)
  const currentItem = currentEntry?.item
  const tvSizeAvailable = Boolean(currentItem && queueItemAudioUrl(currentItem, 'TV_SIZE'))
  const fullSizeAvailable = Boolean(currentItem && queueItemAudioUrl(currentItem, 'FULL_SIZE'))
  const videoAvailable = Boolean(currentItem && queueItemVideoUrl(currentItem))
  const activeSource = currentItem
    ? mode === 'VIDEO' ? queueItemVideoUrl(currentItem) : queueItemAudioUrl(currentItem, mode)
    : undefined
  const activeSourceUrl = activeSource
    ? mode === 'VIDEO' ? resolveVideoUrl(activeSource, api) : resolveAudioUrl(activeSource, api)
    : undefined

  const requestVideoConfirmation = useCallback((item: QueueItem, onConfirm: () => void, onCancel?: () => void) => {
    const warning = videoWarningFor(item)
    if (!warning || confirmedVideoKeysRef.current.has(warning.key)) {
      onConfirm()
      return
    }
    setVideoConfirmation({ ...warning, onConfirm, onCancel })
  }, [])

  const confirmVideo = useCallback(() => {
    const request = videoConfirmation
    if (!request) return
    confirmedVideoKeysRef.current.add(request.key)
    setVideoConfirmation(null)
    request.onConfirm()
  }, [videoConfirmation])

  const cancelVideo = useCallback(() => {
    const request = videoConfirmation
    if (!request) return
    setVideoConfirmation(null)
    request.onCancel?.()
  }, [videoConfirmation])

  useEffect(() => {
    queue.setPreferenceSnapshot(preferenceSnapshot)
  }, [preferenceSnapshot, queue])

  useEffect(() => {
    if (!persistenceUserId) return
    savePersistedQueue(persistenceUserId, queueState)
  }, [persistenceUserId, queueState])

  const updatePosition = useCallback((media?: HTMLMediaElement | null) => {
    const active = media ?? activeMediaRef.current
    if (!active) return
    const nextDuration = finiteMediaNumber(active.duration)
    const nextTime = Math.max(0, finiteMediaNumber(active.currentTime))
    setCurrentTime(nextTime)
    if (nextDuration > 0) setDuration(nextDuration)
    mediaSessionRef.current?.syncState(isPlaying ? 'playing' : 'paused')
  }, [isPlaying])

  const reportPlaybackFailure = useCallback((reason: unknown) => {
    const message = reason instanceof Error && reason.message ? reason.message : 'The browser blocked playback.'
    setError(`Could not start playback. ${message}`)
    setIsPlaying(false)
    setIsLoading(false)
  }, [])

  const play = useCallback(async (): Promise<void> => {
    await sourceReadyRef.current
    const media = activeMediaRef.current
    if (!media || !currentEntry) {
      setError('Choose a theme to start playback.')
      return
    }
    setError(null)
    setIsLoading(true)
    try {
      await media.play()
      setIsPlaying(true)
      setIsLoading(false)
      setIsEnded(false)
    } catch (reason) {
      reportPlaybackFailure(reason)
    }
  }, [currentEntry, reportPlaybackFailure])

  const pause = useCallback(() => {
    activeMediaRef.current?.pause()
    setIsPlaying(false)
  }, [])

  const applyMode = useCallback((nextMode: PlaybackMode) => {
    const item = currentEntry?.item
    if (!item) return
    if (nextMode === 'VIDEO' && !queueItemVideoUrl(item)) {
      setError('Video is not available for this theme.')
      return
    }
    if (nextMode === 'FULL_SIZE' && !queueItemAudioUrl(item, 'FULL_SIZE')) {
      setError('Full-size audio is not available for this theme.')
      return
    }
    if (currentEntry && !isQueueEntryAllowedByPreference(currentEntry, preferenceSnapshot, new Set(queueState.unskippedEntryIds), nextMode)) {
      setError('This playback size is disliked. Unskip this track to play it.')
      return
    }
    const fromMode = modeRef.current
    const oldMedia = activeMediaRef.current
    const oldTime = oldMedia ? finiteMediaNumber(oldMedia.currentTime) : currentTime
    shouldAutoplayRef.current = isPlaying || Boolean(oldMedia && !oldMedia.paused)
    pendingSeekRef.current = {
      from: fromMode,
      to: nextMode,
      time: modeStartTime(fromMode, nextMode, oldTime, queueItemDurationMs(item, nextMode) ? queueItemDurationMs(item, nextMode)! / 1000 : undefined),
      queueId: currentEntry.queueId,
    }
    modeRef.current = nextMode
    setModeState(nextMode)
    setError(null)
  }, [currentEntry, currentTime, isPlaying, preferenceSnapshot, queueState.unskippedEntryIds])

  const setMode = useCallback((nextMode: PlaybackMode) => {
    const item = currentEntry?.item
    if (!item || nextMode !== 'VIDEO') {
      applyMode(nextMode)
      return
    }
    if (!queueItemVideoUrl(item)) {
      applyMode(nextMode)
      return
    }
    requestVideoConfirmation(item, () => applyMode(nextMode))
  }, [applyMode, currentEntry, requestVideoConfirmation])

  const requestAutoplayFor = useCallback((nextMode?: PlaybackMode, autoPlay = true) => {
    shouldAutoplayRef.current = autoPlay
    if (nextMode) {
      modeRef.current = nextMode
      setModeState(nextMode)
    }
  }, [])

  const playItems = useCallback((items: readonly QueueItem[], options: PlayQueueItemOptions = {}) => {
    if (items.length === 0) return
    const requestedIndex = Number.isFinite(options.startIndex) ? Math.trunc(options.startIndex!) : 0
    const startIndex = Math.max(0, Math.min(items.length - 1, requestedIndex))
    const selected = items[startIndex]!
    const requestedMode = options.mode ?? (selected as PlayerQueueItem).mode
    const { mode: _mode, autoPlay, ...queueOptions } = options
    const start = () => {
      requestAutoplayFor(requestedMode, autoPlay !== false)
      queue.play(items, { ...queueOptions, startIndex })
    }
    if (requestedMode === 'VIDEO' && videoWarningFor(selected)) {
      requestVideoConfirmation(selected, start)
      return
    }
    start()
  }, [queue, requestAutoplayFor, requestVideoConfirmation])

  const playItem = useCallback((item: QueueItem, options: PlayQueueItemOptions = {}) => {
    playItems([item], options)
  }, [playItems])

  const playTheme = useCallback((theme: LibraryThemeDto, options: PlayThemeOptions = {}) => {
    const mapped = mapThemeToQueueItem(theme, options)
    playItems([mapped], options)
  }, [playItems])

  const playSong = useCallback((song: MusicTrackDto, options: PlayQueueItemOptions & ThemeQueueItemOptions = {}) => {
    const mapped = mapSongToQueueItem(song, options)
    playItems([mapped], { ...options, mode: options.mode ?? 'FULL_SIZE' })
  }, [playItems])

  const next = useCallback(async () => {
    const before = queueState.currentIndex
    const nextIndex = queue.next()
    if (nextIndex === null) {
      shouldAutoplayRef.current = false
      pause()
      setIsEnded(true)
      return
    }
    shouldAutoplayRef.current = true
    if (nextIndex === before && queueState.repeatMode === 'one') {
      const media = activeMediaRef.current
      if (media) {
        media.currentTime = 0
        setCurrentTime(0)
      }
      await play()
    }
  }, [pause, play, queue, queueState.currentIndex, queueState.repeatMode])

  const previous = useCallback(async () => {
    const media = activeMediaRef.current
    if (media && finiteMediaNumber(media.currentTime) > 3) {
      media.currentTime = 0
      setCurrentTime(0)
      return
    }
    if (queueState.historyEntries.length > 0) {
      shouldAutoplayRef.current = true
      queue.rewindTo(queueState.historyEntries.length - 1)
      return
    }
    if (media) {
      media.currentTime = 0
      setCurrentTime(0)
      await play()
    }
  }, [play, queue, queueState.historyEntries.length])

  const seek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return
    const media = activeMediaRef.current
    if (!media) return
    const total = finiteMediaNumber(media.duration)
    media.currentTime = total > 0 ? Math.max(0, Math.min(total, seconds)) : Math.max(0, seconds)
    updatePosition(media)
  }, [updatePosition])

  const togglePlay = useCallback(async () => {
    if (isPlaying) pause()
    else await play()
  }, [isPlaying, pause, play])

  const onEnded = useCallback(() => {
    setIsEnded(true)
    void next()
  }, [next])

  const onMediaError = useCallback((event: Event) => {
    const target = event.currentTarget as HTMLMediaElement
    if (target !== activeMediaRef.current) return
    setIsLoading(false)
    setIsPlaying(false)
    setError('The selected media could not be loaded.')
  }, [])

  callbacksRef.current = {
    onTimeUpdate: (event) => updatePosition(event.currentTarget as HTMLMediaElement),
    onLoadedMetadata: (event) => {
      const target = event.currentTarget as HTMLMediaElement
      if (target !== activeMediaRef.current) return
      const pending = pendingSeekRef.current
      const targetDuration = finiteMediaNumber(target.duration)
      if (pending && pending.queueId === currentEntry?.queueId && pending.to === modeRef.current) {
        target.currentTime = modeStartTime(pending.from, pending.to, pending.time, targetDuration)
        pendingSeekRef.current = null
      }
      const declaredDuration = currentItem ? queueItemDurationMs(currentItem, mode) : undefined
      setDuration(targetDuration || finiteOr(declaredDuration ? declaredDuration / 1000 : 0, 0))
      setCurrentTime(Math.max(0, finiteMediaNumber(target.currentTime)))
      setIsLoading(false)
      if (shouldAutoplayRef.current) {
        shouldAutoplayRef.current = false
        void target.play().then(() => setIsPlaying(true)).catch(reportPlaybackFailure)
      }
    },
    onPlay: (event) => {
      if (event.currentTarget === activeMediaRef.current) {
        setIsPlaying(true)
        setIsLoading(false)
        const queueId = currentEntry?.queueId
        const playEvent = currentEntry ? createPlayEvent(currentEntry.item, modeRef.current) : undefined
        if (queueId !== undefined && playEvent && api.post && !recordedPlayQueueIdsRef.current.has(queueId)) {
          recordedPlayQueueIdsRef.current.add(queueId)
          void api.post('/v1/plays', [playEvent]).catch(() => undefined)
        }
      }
    },
    onPause: (event) => {
      if (event.currentTarget === activeMediaRef.current) setIsPlaying(false)
    },
    onEnded,
    onError: onMediaError,
  }

  useEffect(() => {
    const elements = [audioElement, videoElement].filter(Boolean) as HTMLMediaElement[]
    const events: Array<[string, keyof MediaCallbacks]> = [
      ['timeupdate', 'onTimeUpdate'],
      ['loadedmetadata', 'onLoadedMetadata'],
      ['play', 'onPlay'],
      ['pause', 'onPause'],
      ['ended', 'onEnded'],
      ['error', 'onError'],
    ]
    const listeners = new Map<string, EventListener>()
    for (const [event, key] of events) listeners.set(event, (payload) => callbacksRef.current[key]?.(payload))
    for (const element of elements) {
      for (const [event] of events) element.addEventListener(event, listeners.get(event)!)
    }
    return () => {
      for (const element of elements) {
        for (const [event] of events) element.removeEventListener(event, listeners.get(event)!)
      }
    }
  }, [audioElement, videoElement])

  useEffect(() => {
    const item = currentEntry?.item
    const videoUrl = item ? queueItemVideoUrl(item) : undefined
    const nextMode: PlaybackMode = item && isModeAvailable(item, mode)
      ? mode
      : item && queueItemAudioUrl(item, 'TV_SIZE')
        ? 'TV_SIZE'
        : item && queueItemAudioUrl(item, 'FULL_SIZE')
          ? 'FULL_SIZE'
          : videoUrl
            ? 'VIDEO'
          : 'TV_SIZE'
    const warning = item && nextMode === 'VIDEO' ? videoWarningFor(item) : undefined
    if (warning && !confirmedVideoKeysRef.current.has(warning.key)) {
      if (videoConfirmation?.key !== warning.key) {
        const fallbackMode = fallbackAudioMode(item!)
        setVideoConfirmation({
          ...warning,
          onConfirm: () => undefined,
          onCancel: () => {
            modeRef.current = fallbackMode
            setModeState(fallbackMode)
          },
        })
      }
      return
    }
    if (nextMode !== mode) {
      modeRef.current = nextMode
      setModeState(nextMode)
      return
    }
    const media = nextMode === 'VIDEO' ? videoRef.current : audioRef.current
    const inactive = nextMode === 'VIDEO' ? audioRef.current : videoRef.current
    activeMediaRef.current = media
    inactive?.pause()
    if (!media) return
    if (!activeSourceUrl) {
      media.removeAttribute('src')
      media.load()
      setIsLoading(false)
      setIsPlaying(false)
      return
    }
    setIsLoading(true)
    setError(null)
    setIsEnded(false)
    setCurrentTime(0)
    const pendingBefore = pendingSeekRef.current
    const preserved = nextMode === 'VIDEO' ? preservedVideoRef.current : null
    if (preserved && !pendingBefore) {
      pendingSeekRef.current = {
        from: nextMode,
        to: nextMode,
        time: preserved.time,
        queueId: currentEntry?.queueId,
      }
      if (preserved.wasPlaying) shouldAutoplayRef.current = true
      preservedVideoRef.current = null
    }
    const pending = pendingBefore ?? pendingSeekRef.current
    const sourceKey = `${currentEntry?.queueId ?? 'none'}:${nextMode}:${activeSourceUrl}`
    if (media === activeMediaRef.current && sourceKeyRef.current === sourceKey && !pending) return
    sourceKeyRef.current = sourceKey
    media.pause()
    media.removeAttribute('src')
    media.load()
    const initialDuration = item ? queueItemDurationMs(item, nextMode) : undefined
    setDuration(initialDuration ? initialDuration / 1000 : 0)
    const pendingTime = pending?.queueId === currentEntry?.queueId && pending?.to === nextMode ? pending?.time : undefined
    let cancelled = false
    let objectUrl: string | null = null
    const sourceUrl = nextMode === 'VIDEO' ? resolveVideoUrl(videoUrl!, api) : activeSourceUrl
    const loadSource = async () => {
      let playableUrl = sourceUrl
      if (nextMode !== 'VIDEO') {
        const cached = await readCachedMedia(sourceUrl, ownedMediaCache)
        if (cancelled) return
        if (cached && typeof URL.createObjectURL === 'function') {
          try {
            objectUrl = URL.createObjectURL(cached)
            cachedObjectUrlRef.current = objectUrl
            playableUrl = objectUrl
          } catch {
            // A browser may expose Cache Storage without blob URL support.
          }
        }
      }
      if (cancelled) return
      media.crossOrigin = isServerRelativeSource(nextMode === 'VIDEO' ? videoUrl : activeSource) ? 'use-credentials' : null
      media.src = playableUrl
      media.load()
      if (pendingTime !== undefined) {
        try { media.currentTime = pendingTime } catch { /* metadata may not be ready yet */ }
      }
      if (shouldAutoplayRef.current && media.readyState >= 1) {
        shouldAutoplayRef.current = false
        void media.play().then(() => { setIsPlaying(true); setIsLoading(false) }).catch(reportPlaybackFailure)
      }
    }
    sourceReadyRef.current = loadSource()
    void sourceReadyRef.current
    return () => {
      cancelled = true
      if (objectUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl)
      if (cachedObjectUrlRef.current === objectUrl) cachedObjectUrlRef.current = null
    }
  }, [activeSourceUrl, api, currentEntry?.queueId, currentItem, currentEntry, mode, ownedMediaCache, reportPlaybackFailure, videoConfirmation?.key, mode === 'VIDEO' ? videoElement : null])

  useEffect(() => {
    if (!isPlaying) return undefined
    const timer = window.setInterval(() => updatePosition(), 250)
    return () => window.clearInterval(timer)
  }, [isPlaying, updatePosition])

  useEffect(() => {
    if (!ownedMediaCache) return
    const nextAudioUrls = queueState.nowPlayingEntries
      .slice(queueState.currentIndex + 1, queueState.currentIndex + 4)
      .map((entry) => queueItemAudioUrl(entry.item, (entry.item as PlayerQueueItem).mode ?? 'TV_SIZE'))
      .filter((url): url is string => Boolean(url?.trim()))
      .map((url) => resolveAudioUrl(url, api))
    void ownedMediaCache.reconcile({
      imageUrls: currentItem?.artworkUrl ? [resolveAudioUrl(currentItem.artworkUrl, api)] : [],
      nextAudioUrls,
    }).catch(() => undefined)
  }, [api, currentEntry?.queueId, currentItem?.artworkUrl, ownedMediaCache, queueState.currentIndex, queueState.queueVersion, queueState.nowPlayingEntries])

  useEffect(() => {
    if (!ownedMediaCache || currentItem || queueState.nowPlayingEntries.length > 0) return
    clearMediaCache(ownedMediaCache)
  }, [currentItem, ownedMediaCache, queueState.nowPlayingEntries.length])

  useEffect(() => () => {
    clearMediaCache(ownedMediaCache)
    if (cachedObjectUrlRef.current && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(cachedObjectUrlRef.current)
    cachedObjectUrlRef.current = null
  }, [ownedMediaCache])

  useEffect(() => {
    const session = getMediaSession()
    const media = activeMediaRef.current
    if (!session || !media) return undefined
    const adapter = new BrowserMediaSession(media, session, { previous: () => { void previous() }, next: () => { void next() } })
    mediaSessionRef.current = adapter
    adapter.start()
    if (currentItem) adapter.updateMetadata({ title: currentItem.title, artist: currentItem.artist, album: currentItem.album, artworkUrl: currentItem.artworkUrl })
    adapter.syncState(isPlaying ? 'playing' : 'paused')
    return () => {
      adapter.dispose()
      session.metadata = null
      if (mediaSessionRef.current === adapter) mediaSessionRef.current = null
    }
  }, [currentEntry?.queueId, currentItem, isPlaying, mode, next, previous])

  const requestFullscreen = useCallback(async () => {
    const video = videoRef.current
    if (!video || !videoAvailable) return
    const target = videoSurface?.closest<HTMLElement>('.player-now-playing__stage') ?? video
    if (typeof target.requestFullscreen === 'function') await target.requestFullscreen()
  }, [videoAvailable, videoSurface])

  const value = useMemo<PlayerContextValue>(() => ({
    queue,
    queueStore: queue,
    queueState,
    currentEntry,
    currentItem,
    mode,
    isPlaying,
    isLoading,
    isEnded,
    currentTime,
    duration,
    error,
    tvSizeAvailable,
    fullSizeAvailable,
    videoAvailable,
    activeSourceUrl,
    audioElement,
    videoElement,
    registerVideoSurface,
    playTheme,
    playSong,
    playItem,
    playItems,
    play,
    pause,
    togglePlay,
    next,
    previous,
    seek,
    setMode,
    toggleShuffle: () => { queue.toggleShuffle() },
    setShuffle: (shuffled) => { queue.setShuffled(shuffled) },
    cycleRepeat: () => queue.cycleRepeatMode(),
    setRepeat: (repeat) => { queue.setRepeatMode(repeat) },
    skipTo: (index) => { requestAutoplayFor(); queue.skipTo(index) },
    unskipEntry: (queueId) => { queue.unskipEntry(queueId) },
    requestFullscreen,
  }), [activeSourceUrl, audioElement, currentEntry, currentItem, duration, error, fullSizeAvailable, isEnded, isLoading, isPlaying, mode, next, pause, play, playItem, playItems, playSong, playTheme, previous, queue, queueState, requestAutoplayFor, requestFullscreen, seek, setMode, togglePlay, tvSizeAvailable, videoAvailable, videoElement])

  return (
    <PlayerContext.Provider value={value}>
      <div className="player-runtime" data-testid="player-runtime">
        <audio ref={(element) => { audioRef.current = element; setAudioElement(element) }} data-testid="player-audio" className="player-audio" preload="metadata" aria-hidden="true" />
        {videoSurface ? createPortal(<video ref={assignVideoElement} data-testid="player-video" className={`player-video${mode === 'VIDEO' ? ' player-video--visible' : ''}`} preload="metadata" playsInline aria-label={currentItem ? `${currentItem.title} video` : 'Video player'} />, videoSurface) : <video ref={assignVideoElement} data-testid="player-video" className="player-video" preload="metadata" playsInline aria-label={currentItem ? `${currentItem.title} video` : 'Video player'} />}
        {videoConfirmation && <VideoSafetyDialog title={videoConfirmation.title} spoiler={videoConfirmation.spoiler} nsfw={videoConfirmation.nsfw} onCancel={cancelVideo} onContinue={confirmVideo} />}
        {children}
      </div>
    </PlayerContext.Provider>
  )
}

export function usePlayer(): PlayerContextValue {
  const value = useContext(PlayerContext)
  if (!value) throw new Error('usePlayer must be used inside PlayerProvider.')
  return value
}

export function resolveAudioUrl(url: string, api: Pick<ApiClient, 'url'> = apiClient): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) return url
  if (url.startsWith('/api/')) return url
  return api.url(url)
}

function resolveVideoUrl(url: string, api: Pick<ApiClient, 'url'>): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('/api/')) return url
  return api.url(url)
}

function createBrowserMediaCache(): ManagedMediaCache | undefined {
  if (typeof caches === 'undefined') return undefined
  try {
    const namespace = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return new ManagedMediaCache({ storage: browserCacheStorage(caches), namespace })
  } catch {
    return undefined
  }
}

async function readCachedMedia(url: string, cache: ManagedMediaCache | undefined): Promise<Blob | undefined> {
  if (!cache || typeof URL.createObjectURL !== 'function') return undefined
  try {
    const response = await cache.matchAudio(url)
    if (!response || !response.ok) return undefined
    return await response.blob()
  } catch {
    return undefined
  }
}

function getMediaSession(): MediaSessionPort | undefined {
  if (typeof navigator === 'undefined') return undefined
  const session = (navigator as Navigator & { mediaSession?: MediaSessionPort }).mediaSession
  return session
}

interface MediaCallbacks {
  onTimeUpdate?: EventListener
  onLoadedMetadata?: EventListener
  onPlay?: EventListener
  onPause?: EventListener
  onEnded?: EventListener
  onError?: EventListener
}

interface VideoConfirmationRequest {
  readonly key: string
  readonly title: string
  readonly spoiler: boolean
  readonly nsfw: boolean
  readonly onConfirm: () => void
  readonly onCancel?: () => void
}

function finiteMediaNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function isServerRelativeSource(value: string | undefined): boolean {
  return Boolean(value && value.startsWith('/') && !value.startsWith('//'))
}

function isModeAvailable(item: QueueItem, mode: PlaybackMode): boolean {
  return mode === 'VIDEO' ? Boolean(queueItemVideoUrl(item)) : Boolean(queueItemAudioUrl(item, mode))
}

function videoWarningFor(item: QueueItem): Omit<VideoConfirmationRequest, 'onConfirm' | 'onCancel'> | undefined {
  const candidate = item as PlayerQueueItem
  const spoiler = candidate.videoSpoiler === true
  const nsfw = candidate.videoNsfw === true
  if (!spoiler && !nsfw) return undefined
  const itemId = candidate.themeId ?? candidate.id
  return {
    key: `THEME:${String(itemId)}`,
    title: item.title,
    spoiler,
    nsfw,
  }
}

function fallbackAudioMode(item: QueueItem): PlaybackMode {
  return queueItemAudioUrl(item, 'TV_SIZE') ? 'TV_SIZE' : 'FULL_SIZE'
}

function clearMediaCache(cache: ManagedMediaCache | undefined): void {
  const clear = (cache as (ManagedMediaCache & { clear?: () => Promise<void> }) | undefined)?.clear
  if (!clear) return
  try {
    void Promise.resolve(clear.call(cache)).catch(() => undefined)
  } catch {
    // Cache cleanup is best effort and must not interrupt unmount/logout.
  }
}

function createPlayEvent(item: QueueItem, mode: PlaybackMode) {
  const candidate = item as PlayerQueueItem
  const itemId = candidate.itemType === 'SONG' ? candidate.songId : candidate.themeId
  if (!Number.isSafeInteger(itemId) || (itemId ?? 0) <= 0) return undefined
  return {
    clientEventId: createClientEventId(),
    itemType: candidate.itemType,
    itemId: itemId!,
    actualMode: candidate.itemType === 'SONG' ? 'AUDIO' : mode,
    playedAt: Date.now(),
  }
}

function createClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
