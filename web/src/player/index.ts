import './player.css'

export { PlayerProvider, usePlayer, resolveAudioUrl } from './PlayerProvider'
export type { PlayerContextValue, PlayerProviderProps, PlayerState, PlayQueueItemOptions, PlayThemeOptions } from './PlayerProvider'
export { NowPlayingView } from './NowPlayingView'
export type { NowPlayingViewProps } from './NowPlayingView'
export { MiniPlayerView } from './MiniPlayerView'
export type { MiniPlayerViewProps } from './MiniPlayerView'
export { runPlayerViewTransition } from './viewTransition'
export {
  desiredCurrentQueueIndex,
  emptyQueuePreferenceSnapshot,
  filterQueueEntriesForPlayback,
  isQueueEntryAllowedByPreference,
  isQueueItemAllowedByPreference,
  nextEligibleQueueIndex,
} from './preferenceQueue'
export type { QueuePreferenceSnapshot, QueueSongPreference, QueueThemePreference } from './preferenceQueue'
export { mapSongToQueueItem, mapThemeToQueueItem, queueItemAudioUrl, queueItemDurationMs, queueItemVideoUrl } from './mapping'
export type { PlayerQueueItem, ThemeQueueItemOptions } from './mapping'
export { QUEUE_PERSISTENCE_VERSION, loadPersistedQueue, queuePersistenceKey, savePersistedQueue } from './queuePersistence'
export * from './queue'
export { windowQueueEntries } from './queueWindow'
export type { QueueWindow, QueueWindowOptions } from './queueWindow'
