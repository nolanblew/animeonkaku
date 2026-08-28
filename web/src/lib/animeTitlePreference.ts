import { useSyncExternalStore } from 'react'

export type AnimeTitlePreference = 'ENGLISH' | 'ROMAJI' | 'JAPANESE'

export interface AnimeTitleSource {
  title?: string | null
  titleEn?: string | null
  titleRomaji?: string | null
  titleJa?: string | null
}

export const ANIME_TITLE_PREFERENCE_STORAGE_KEY = 'anime-ongaku.web.anime-title-preference.v1'
const preferenceEvent = 'anime-ongaku:anime-title-preference'
const defaultPreference: AnimeTitlePreference = 'ENGLISH'

export function readAnimeTitlePreference(): AnimeTitlePreference {
  if (typeof window === 'undefined') return defaultPreference
  return parsePreference(window.localStorage.getItem(ANIME_TITLE_PREFERENCE_STORAGE_KEY))
}

export function writeAnimeTitlePreference(preference: AnimeTitlePreference): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ANIME_TITLE_PREFERENCE_STORAGE_KEY, preference)
  window.dispatchEvent(new Event(preferenceEvent))
}

export function subscribeToAnimeTitlePreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const onStorage = (event: StorageEvent) => {
    if (event.key === ANIME_TITLE_PREFERENCE_STORAGE_KEY) listener()
  }
  window.addEventListener(preferenceEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(preferenceEvent, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAnimeTitlePreference(): AnimeTitlePreference {
  return useSyncExternalStore(subscribeToAnimeTitlePreference, readAnimeTitlePreference, () => defaultPreference)
}

export function preferredAnimeTitle(source: AnimeTitleSource | null | undefined, preference = readAnimeTitlePreference()): string {
  if (!source) return ''
  const ordered = preference === 'ROMAJI'
    ? [source.titleRomaji, source.title, source.titleEn, source.titleJa]
    : preference === 'JAPANESE'
      ? [source.titleJa, source.title, source.titleRomaji, source.titleEn]
      : [source.titleEn, source.title, source.titleRomaji, source.titleJa]
  return ordered.map((value) => value?.trim()).find(Boolean) ?? ''
}

function parsePreference(value: string | null): AnimeTitlePreference {
  return value === 'ROMAJI' || value === 'JAPANESE' || value === 'ENGLISH' ? value : defaultPreference
}
