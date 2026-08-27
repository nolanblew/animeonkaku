import type { PlaybackMode } from '../media/modeSwitch'

/** Audio modes are remembered per signed-in browser user; Video is always session-only. */
export type RememberedAudioMode = Extract<PlaybackMode, 'TV_SIZE' | 'FULL_SIZE'>

export const PLAYBACK_PREFERENCES_VERSION = 1

const STORAGE_PREFIX = `anime-ongaku:playback-preferences:v${PLAYBACK_PREFERENCES_VERSION}:`

export function playbackPreferencesKey(kitsuUserId: string): string {
  return `${STORAGE_PREFIX}${kitsuUserId}`
}

export function loadRememberedAudioMode(kitsuUserId: string): RememberedAudioMode | undefined {
  const storage = browserStorage()
  if (!storage || !isKitsuUserId(kitsuUserId)) return undefined
  try {
    const value = storage.getItem(playbackPreferencesKey(kitsuUserId))
    return isRememberedAudioMode(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function saveRememberedAudioMode(kitsuUserId: string, mode: PlaybackMode): void {
  const storage = browserStorage()
  if (!storage || !isKitsuUserId(kitsuUserId) || !isRememberedAudioMode(mode)) return
  try {
    storage.setItem(playbackPreferencesKey(kitsuUserId), mode)
  } catch {
    // Storage can be unavailable or full. Playback must remain usable either way.
  }
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function isRememberedAudioMode(value: unknown): value is RememberedAudioMode {
  return value === 'TV_SIZE' || value === 'FULL_SIZE'
}

function isKitsuUserId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 256
}
