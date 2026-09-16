import { describe, expect, it } from 'vitest'
import { topPickQueueItem } from './Pages'
import type { BrowserTopPick } from '../features/catalog/types'
import { createEmptyLibrary, type ThemePrefDto } from '../lib/library'
import { resolveQueueItemMode } from '../player/preferenceQueue'

const pick: BrowserTopPick = {
  key: 'THEME:1', itemType: 'THEME', itemId: 1, reason: 'DISCOVERY', artworkUrl: null, anime: null, preference: null,
  theme: {
    id: 1, animeThemesAnimeId: 1, kitsuAnimeIds: ['1'], title: 'Full-only opening', themeType: 'OP1', artists: [],
    audioUrl: '/v1/media/audio/1', videoUrl: null, audioState: 'MISSING', durationSeconds: 90, fileSize: null,
    mediaModes: {
      tvSize: { url: '/v1/media/audio/1', durationSeconds: 90, fileSize: null },
      fullSize: { songId: 2, url: '/v1/media/songs/2/audio', durationSeconds: 240, fileSize: 100, sourceReleaseId: 3 },
      video: null,
    },
    updatedAt: 1, deleted: false,
  },
}
const preference = (overrides: Partial<ThemePrefDto>): ThemePrefDto => ({
  themeId: 1, liked: false, disliked: false, dislikedTvSize: false, dislikedFullSize: false,
  preferredMode: null, playCount: 0, lastPlayedAt: null, updatedAt: 1, deleted: false, ...overrides,
})

describe('Top picks playback projection', () => {
  it('plays ready full audio when the TV endpoint exists but its media is missing', () => {
    const item = topPickQueueItem(pick, null)!
    expect(item.mode).toBe('FULL_SIZE')
    expect(item.tvAudioUrl).toBeUndefined()
    expect(item.fullAudioUrl).toBe('/v1/media/songs/2/audio')
    expect(resolveQueueItemMode(item, { themesById: { '1': { preferredMode: 'TV_SIZE' } }, songsById: {} }, 'TV_SIZE')).toBe('FULL_SIZE')
  })

  it('honors a newer local dislike instead of an older snapshot reaction', () => {
    const library = createEmptyLibrary()
    library.prefsByThemeId['1'] = preference({ disliked: true, updatedAt: 20 })
    expect(topPickQueueItem({ ...pick, preference: preference({ updatedAt: 10 }) }, library)).toBeNull()
  })

  it('uses a newer local size preference for a ready dual-mode pick', () => {
    const library = createEmptyLibrary()
    library.prefsByThemeId['1'] = preference({ preferredMode: 'TV_SIZE', updatedAt: 20 })
    const item = topPickQueueItem({ ...pick, theme: { ...pick.theme, audioState: 'READY' }, preference: preference({ preferredMode: 'FULL_SIZE', updatedAt: 10 }) }, library)!
    expect(item.mode).toBe('TV_SIZE')
  })
})
