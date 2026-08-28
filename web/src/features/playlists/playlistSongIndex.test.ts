import { describe, expect, it } from 'vitest'
import { createEmptyLibrary, type MusicAnimeSummaryDto, type MusicReleaseDto, type MusicTrackDto, type NormalizedLibrary } from '../../lib/library'
import { buildPlaylistSongIndex } from './playlistDisplay'

function libraryWithCatalogs(): NormalizedLibrary {
  const makeAnime = (id: string): MusicAnimeSummaryDto => ({ kitsuId: id, title: id, titleEn: null, posterUrl: null })
  const makeTrack = (id: number): MusicTrackDto => ({
    id,
    title: `Song ${id}`,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Band',
    artistNames: [],
    durationSeconds: 120,
    audioUrl: `/audio/${id}`,
    fileSize: null,
    discNumber: 1,
    trackNumber: 1,
    displayOrder: 0,
  })
  const makeRelease = (id: number, anime: MusicAnimeSummaryDto, tracks: MusicTrackDto[]): MusicReleaseDto => ({
    id,
    title: `Release ${id}`,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: 'Band',
    artistNames: [],
    relationshipType: 'SOUNDTRACK',
    releaseDate: null,
    year: null,
    artworkUrl: null,
    tracks,
    anime: [{ ...anime, relationshipType: 'SOUNDTRACK' }],
  })
  const first = makeAnime('anime-one')
  const second = makeAnime('anime-two')
  return {
    ...createEmptyLibrary(),
    musicCatalogByAnimeId: {
      [first.kitsuId]: { anime: first, releases: [makeRelease(1, first, [makeTrack(101), makeTrack(102)])] },
      [second.kitsuId]: { anime: second, releases: [makeRelease(2, second, [makeTrack(201), makeTrack(202)])] },
    },
  }
}

describe('playlist song index contract', () => {
  it('builds one O(1) song lookup across every catalog and retains source context', () => {
    const index = buildPlaylistSongIndex(libraryWithCatalogs())

    expect(index).toBeInstanceOf(Map)
    expect(index.size).toBe(4)
    expect(index.get(201)).toEqual(expect.objectContaining({ song: expect.objectContaining({ id: 201 }), animeId: 'anime-two', releaseId: 2 }))
    expect(index.get(999)).toBeUndefined()
  })
})
