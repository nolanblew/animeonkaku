import { describe, expect, it } from 'vitest'
import {
  applyChanges,
  createEmptyLibrary,
  selectActiveAnime,
  selectActivePlaylists,
  selectActiveThemes,
  type ChangesResponse,
} from './library'

function changes(overrides: Partial<ChangesResponse> = {}): ChangesResponse {
  return {
    serverTime: 100,
    anime: [
      {
        kitsuId: '1',
        animeThemesId: 10,
        title: 'First Anime',
        titleEn: 'First Anime',
        titleRomaji: null,
        titleJa: null,
        posterUrl: '/poster/1',
        coverUrl: null,
        watchingStatus: 'current',
        subtype: 'TV',
        startDate: null,
        endDate: null,
        episodeCount: 12,
        ageRating: null,
        averageRating: null,
        userRating: null,
        libraryUpdatedAt: 100,
        slug: 'first-anime',
        genres: ['action'],
        updatedAt: 100,
        deleted: false,
      },
    ],
    themes: [],
    prefs: [],
    songPrefs: [],
    playlists: [],
    ...overrides,
  }
}

describe('normalized library model', () => {
  it('normalizes the initial snapshot and advances its server cursor', () => {
    const result = applyChanges(createEmptyLibrary(), changes())

    expect(result.cursor).toBe(100)
    expect(result.animeById['1']?.title).toBe('First Anime')
    expect(selectActiveAnime(result)).toHaveLength(1)
  })

  it('applies cursor deltas, preserves omitted collections, and removes tombstoned rows from active selectors', () => {
    const initial = applyChanges(createEmptyLibrary(), changes())
    const delta = changes({
      serverTime: 200,
      anime: [{ ...changes().anime[0]!, title: 'Renamed', updatedAt: 200, deleted: true }],
    })

    const result = applyChanges(initial, delta)

    expect(result.cursor).toBe(200)
    expect(result.animeById['1']?.title).toBe('Renamed')
    expect(result.animeById['1']?.deleted).toBe(true)
    expect(selectActiveAnime(result)).toEqual([])
  })

  it('normalizes every entity collection and never moves the cursor backwards', () => {
    const initial = applyChanges(createEmptyLibrary(), changes({
      themes: [{
        id: 20,
        animeThemesAnimeId: 10,
        kitsuAnimeIds: ['1'],
        title: 'Opening',
        themeType: 'OP1',
        artists: [],
        audioUrl: '/audio/20',
        videoUrl: null,
        audioState: 'READY',
        durationSeconds: 90,
        fileSize: null,
        mediaModes: { tvSize: { url: '/audio/20', durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
        updatedAt: 100,
        deleted: false,
      }],
      prefs: [{ themeId: 20, liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false, preferredMode: null, playCount: 1, lastPlayedAt: 100, updatedAt: 100, deleted: false }],
      songPrefs: [{ songId: 30, liked: true, disliked: false, playCount: 1, lastPlayedAt: 100, updatedAt: 100, deleted: false }],
      playlists: [{ id: 40, name: 'Favorites', entries: [20], defaultMode: 'TV_SIZE', overrideUserPreference: false, items: [], isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 100, deleted: false, dynamicSpecJson: null, dynamicSortJson: null }],
      musicCatalog: [{ anime: { kitsuId: '1', title: 'First Anime', titleEn: 'First Anime', posterUrl: null }, releases: [] }],
    }))

    expect(Object.keys(initial.themesById)).toEqual(['20'])
    expect(Object.keys(initial.prefsByThemeId)).toEqual(['20'])
    expect(Object.keys(initial.songPrefsById)).toEqual(['30'])
    expect(selectActiveThemes(initial)).toHaveLength(1)
    expect(selectActivePlaylists(initial)).toHaveLength(1)
    expect(Object.keys(initial.musicCatalogByAnimeId)).toEqual(['1'])

    const older = applyChanges(initial, { ...changes(), serverTime: 50, anime: [], themes: [], prefs: [], songPrefs: [], playlists: [] })
    expect(older.cursor).toBe(100)
    expect(older.musicCatalogByAnimeId['1']).toBeDefined()
  })
})
