import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANIME_TITLE_PREFERENCE_STORAGE_KEY,
  preferredAnimeTitle,
  readAnimeTitlePreference,
  subscribeToAnimeTitlePreference,
  writeAnimeTitlePreference,
} from './animeTitlePreference'

beforeEach(() => localStorage.clear())

describe('anime title preference', () => {
  const titles = {
    title: 'Canonical title',
    titleEn: 'English title',
    titleRomaji: 'Romaji title',
    titleJa: '日本語タイトル',
  }

  it('defaults to English and uses bounded fallbacks for missing translations', () => {
    expect(readAnimeTitlePreference()).toBe('ENGLISH')
    expect(preferredAnimeTitle(titles, 'ENGLISH')).toBe('English title')
    expect(preferredAnimeTitle(titles, 'ROMAJI')).toBe('Romaji title')
    expect(preferredAnimeTitle(titles, 'JAPANESE')).toBe('日本語タイトル')
    expect(preferredAnimeTitle({ title: 'Only title' }, 'JAPANESE')).toBe('Only title')
  })

  it('persists valid choices and notifies same-tab subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAnimeTitlePreference(listener)
    writeAnimeTitlePreference('ROMAJI')
    expect(localStorage.getItem(ANIME_TITLE_PREFERENCE_STORAGE_KEY)).toBe('ROMAJI')
    expect(readAnimeTitlePreference()).toBe('ROMAJI')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
