import { describe, expect, it } from 'vitest'
import type { LibraryAnimeDto } from '../../lib/library'
import { displayTitle, filterAndSortAnime, statusLabel } from './selectors'

function anime(overrides: Partial<LibraryAnimeDto> = {}): LibraryAnimeDto {
  return {
    kitsuId: '1', animeThemesId: null, title: 'Primary', titleEn: 'English', titleRomaji: 'Romaji', titleJa: 'Japanese',
    posterUrl: null, coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null, endDate: null,
    episodeCount: null, ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1, slug: 'primary-show',
    genres: ['Drama'], updatedAt: 1, deleted: false, ...overrides,
  }
}

describe('catalog selectors', () => {
  it('filters alternate metadata and status before applying every sort mode', () => {
    const items = [
      anime({ kitsuId: 'a', title: 'Zulu', titleEn: 'Hidden hero', watchingStatus: 'current', updatedAt: 2 }),
      anime({ kitsuId: 'b', title: 'Alpha', slug: 'secret-slug', genres: ['Music'], watchingStatus: 'completed', updatedAt: 2 }),
      anime({ kitsuId: 'c', title: 'Beta', watchingStatus: null, updatedAt: 4 }),
    ]
    expect(filterAndSortAnime(items, 'hidden hero', 'all', 'recent').map((item) => item.kitsuId)).toEqual(['a'])
    expect(filterAndSortAnime(items, 'music', 'completed', 'recent').map((item) => item.kitsuId)).toEqual(['b'])
    expect(filterAndSortAnime(items, '', 'current', 'recent').map((item) => item.kitsuId)).toEqual(['a'])
    expect(filterAndSortAnime(items, '', 'all', 'title-asc').map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Zulu'])
    expect(filterAndSortAnime(items, '', 'all', 'title-desc').map((item) => item.title)).toEqual(['Zulu', 'Beta', 'Alpha'])
    expect(filterAndSortAnime(items, '', 'all', 'recent').map((item) => item.title)).toEqual(['Beta', 'Alpha', 'Zulu'])
  })

  it('uses the complete title fallback chain and readable status labels', () => {
    expect(displayTitle(anime({ title: '', titleEn: 'English' }))).toBe('English')
    expect(displayTitle(anime({ title: '', titleEn: null, titleRomaji: 'Romaji' }))).toBe('Romaji')
    expect(displayTitle(anime({ title: '', titleEn: null, titleRomaji: null, titleJa: '日本語' }))).toBe('日本語')
    expect(displayTitle(anime({ title: '', titleEn: null, titleRomaji: null, titleJa: null }))).toBe('Untitled anime')
    expect(statusLabel(null)).toBe('Saved')
    expect(statusLabel('on_hold')).toBe('On Hold')
  })
})
