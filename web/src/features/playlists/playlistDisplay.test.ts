import { describe, expect, it } from 'vitest'
import { createEmptyLibrary, type PlaylistDto } from '../../lib/library'
import { resolvePlaylistDisplayItems } from './playlistDisplay'

function playlist(overrides: Partial<PlaylistDto> = {}): PlaylistDto {
  return {
    id: 1,
    name: 'Mix',
    entries: [],
    items: [],
    defaultMode: 'TV_SIZE',
    overrideUserPreference: false,
    isAuto: false,
    isDynamic: false,
    autoUpdate: false,
    updatedAt: 1,
    deleted: false,
    dynamicSpecJson: null,
    dynamicSortJson: null,
    ...overrides,
  }
}

describe('playlist display metadata', () => {
  it('resolves legacy theme entries to catalog names and artwork', () => {
    const library = createEmptyLibrary()
    library.animeById.anime = {
      kitsuId: 'anime', animeThemesId: 7, title: 'Series', titleEn: 'Series EN', titleRomaji: null, titleJa: null,
      posterUrl: '/poster.jpg', coverUrl: null, watchingStatus: null, subtype: 'TV', startDate: null, endDate: null,
      episodeCount: null, ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1, slug: null,
      genres: [], updatedAt: 1, deleted: false,
    }
    library.themesById['10'] = {
      id: 10, animeThemesAnimeId: 7, kitsuAnimeIds: ['anime'], title: 'Opening Song', themeType: 'OP1',
      artists: [{ name: 'The Band', asCharacter: null, alias: null }], audioUrl: '/audio/10', videoUrl: null,
      audioState: 'READY', durationSeconds: 89.9, fileSize: null,
      mediaModes: { tvSize: { url: '/audio/10', durationSeconds: 89.9, fileSize: null }, fullSize: null, video: null },
      updatedAt: 1, deleted: false,
    }

    expect(resolvePlaylistDisplayItems(playlist({ entries: [10] }), library)).toEqual([
      expect.objectContaining({ title: 'Opening Song', subtitle: 'Series EN · OP1 · The Band', artworkUrl: '/api/poster.jpg', durationSeconds: 89.9, available: true }),
    ])
  })

  it('resolves full songs from the music catalog', () => {
    const library = createEmptyLibrary()
    library.musicCatalogByAnimeId.anime = {
      anime: { kitsuId: 'anime', title: 'Series', titleEn: null, posterUrl: '/anime.jpg' },
      releases: [{
        id: 4, title: 'Original Soundtrack', titleEnglish: null, titleRomaji: null, titleJapanese: null,
        artistCredit: 'Release Artist', artistNames: [], relationshipType: 'SOUNDTRACK', releaseDate: null,
        year: null, artworkUrl: '/release.jpg',
        tracks: [{
          id: 55, title: 'Full Song', titleEnglish: null, titleRomaji: null, titleJapanese: null,
          artistCredit: 'Song Artist', artistNames: [], durationSeconds: 240, audioUrl: '/songs/55', fileSize: null,
          discNumber: 1, trackNumber: 1, displayOrder: 1,
        }],
      }],
    }

    const rows = resolvePlaylistDisplayItems(playlist({ items: [{ entryId: 8, itemType: 'SONG', itemId: 55, modeOverride: null }] }), library)
    expect(rows[0]).toEqual(expect.objectContaining({ title: 'Full Song', subtitle: 'Series · Song Artist', artworkUrl: '/api/release.jpg', durationSeconds: 240, available: true }))
  })

  it('uses a safe unavailable row for missing or deleted catalog items', () => {
    const library = createEmptyLibrary()
    library.themesById['10'] = {
      id: 10, animeThemesAnimeId: 7, kitsuAnimeIds: [], title: 'Deleted title', themeType: null, artists: [],
      audioUrl: '', videoUrl: null, audioState: 'MISSING', durationSeconds: null, fileSize: null,
      mediaModes: { tvSize: { url: '', durationSeconds: null, fileSize: null }, fullSize: null, video: null },
      updatedAt: 1, deleted: true,
    }
    const rows = resolvePlaylistDisplayItems(playlist({ items: [
      { entryId: 1, itemType: 'THEME', itemId: 10, modeOverride: null },
      { entryId: 2, itemType: 'SONG', itemId: 999, modeOverride: null },
    ] }), library)

    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.title === 'Unavailable track' && row.available === false)).toBe(true)
    expect(rows.flatMap((row) => [row.title, row.subtitle]).join(' ')).not.toContain('999')
  })
})
