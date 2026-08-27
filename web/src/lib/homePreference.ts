export const SHOW_OSTS_ON_HOME_KEY = 'anime-ongaku.showOstsOnHome'
export const HOME_PREFERENCE_CHANGE_EVENT = 'anime-ongaku:home-preference-change'

const DEFAULT_SHOW_OSTS_ON_HOME = true

export function readShowOstsOnHome(): boolean {
  if (typeof window === 'undefined') return DEFAULT_SHOW_OSTS_ON_HOME
  const stored = window.localStorage.getItem(SHOW_OSTS_ON_HOME_KEY)
  return stored === null ? DEFAULT_SHOW_OSTS_ON_HOME : stored === 'true'
}

export function writeShowOstsOnHome(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SHOW_OSTS_ON_HOME_KEY, String(value))
  window.dispatchEvent(new Event(HOME_PREFERENCE_CHANGE_EVENT))
}

export function subscribeToHomePreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('storage', listener)
  window.addEventListener(HOME_PREFERENCE_CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener('storage', listener)
    window.removeEventListener(HOME_PREFERENCE_CHANGE_EVENT, listener)
  }
}
