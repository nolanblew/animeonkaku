import { describe, expect, it } from 'vitest'
import { compareThemeTypes, formatThemeType, themePresentation } from './themePresentation'

describe('mobile-compatible theme presentation', () => {
  it('makes anime and type primary while keeping song and artist secondary', () => {
    expect(themePresentation({
      animeTitle: 'A Couple of Cuckoos',
      themeType: 'ED2',
      songTitle: 'HELLO HELLO HELLO',
      artist: 'Eir Aoi',
    })).toEqual({
      primary: 'A Couple of Cuckoos · ED 2',
      secondary: 'HELLO HELLO HELLO · Eir Aoi',
      typeLabel: 'ED 2',
    })
  })

  it('uses bounded fallbacks without duplicating the song title', () => {
    expect(themePresentation({ songTitle: 'Blue Bird', themeType: 'OP1' })).toEqual({
      primary: 'OP 1 · Blue Bird',
      secondary: 'Blue Bird',
      typeLabel: 'OP 1',
    })
    expect(formatThemeType(' ending 12 ')).toBe('ED 12')
  })

  it('naturally sorts openings, endings, and numbered variants', () => {
    const values = ['ED2', 'OP10', 'ED', 'OP2', 'Insert Song', 'OP1']
    expect(values.sort(compareThemeTypes)).toEqual(['OP1', 'OP2', 'OP10', 'ED', 'ED2', 'Insert Song'])
  })
})
