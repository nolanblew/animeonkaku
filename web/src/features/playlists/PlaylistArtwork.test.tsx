import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlaylistArtwork, playlistArtworkUrls } from './PlaylistArtwork'
import { createEmptyLibrary, type NormalizedLibrary } from '../../lib/library'
import playlistCss from './playlists.css?raw'

describe('PlaylistArtwork', () => {
  it.each([
    [['/one.jpg'], 'single'],
    [['/one.jpg', '/two.jpg'], 'double'],
    [['/one.jpg', '/two.jpg', '/three.jpg', '/four.jpg', '/ignored.jpg'], 'quad'],
  ])('uses the mobile collage layout for %s', (urls, layout) => {
    render(<PlaylistArtwork playlistId={9} name="Favorites" artworkUrls={urls} />)
    const artwork = screen.getByTestId('playlist-artwork-9')
    expect(artwork).toHaveAttribute('data-layout', layout)
    expect(artwork.querySelectorAll('img')).toHaveLength(Math.min(urls.length, 4))
  })

  it('renders a deliberate music fallback for an empty playlist', () => {
    render(<PlaylistArtwork playlistId={10} name="Empty mix" artworkUrls={[]} />)
    expect(screen.getByTestId('playlist-artwork-10')).toHaveAttribute('data-layout', 'empty')
    expect(screen.getByLabelText('Empty mix has no artwork yet')).toBeInTheDocument()
  })

  it('keeps playlist collage tiles unique when several entries share an anime or image', () => {
    const library = createEmptyLibrary()
    library.animeById = {
      'anime-1': { kitsuId: 'anime-1', title: 'One', titleEn: 'One', titleRomaji: null, titleJa: null, posterUrl: '/same.jpg', coverUrl: null, watchingStatus: null, subtype: 'TV', startDate: null, endDate: null, episodeCount: null, genres: [], updatedAt: 1, deleted: false },
      'anime-2': { kitsuId: 'anime-2', title: 'Two', titleEn: 'Two', titleRomaji: null, titleJa: null, posterUrl: '/same.jpg', coverUrl: null, watchingStatus: null, subtype: 'TV', startDate: null, endDate: null, episodeCount: null, genres: [], updatedAt: 1, deleted: false },
      'anime-3': { kitsuId: 'anime-3', title: 'Three', titleEn: 'Three', titleRomaji: null, titleJa: null, posterUrl: '/other.jpg', coverUrl: null, watchingStatus: null, subtype: 'TV', startDate: null, endDate: null, episodeCount: null, genres: [], updatedAt: 1, deleted: false },
    } as NormalizedLibrary['animeById']
    library.themesById = {
      '1': { id: 1, animeThemesAnimeId: 1, kitsuAnimeIds: ['anime-1'], title: 'Opening 1', themeType: 'OP', artists: [], audioUrl: '', videoUrl: null, audioState: 'READY', durationSeconds: null, fileSize: null, mediaModes: { tv: false, full: false }, updatedAt: 1, deleted: false },
      '2': { id: 2, animeThemesAnimeId: 1, kitsuAnimeIds: ['anime-1'], title: 'Ending 1', themeType: 'ED', artists: [], audioUrl: '', videoUrl: null, audioState: 'READY', durationSeconds: null, fileSize: null, mediaModes: { tv: false, full: false }, updatedAt: 1, deleted: false },
      '3': { id: 3, animeThemesAnimeId: 2, kitsuAnimeIds: ['anime-2'], title: 'Opening 2', themeType: 'OP', artists: [], audioUrl: '', videoUrl: null, audioState: 'READY', durationSeconds: null, fileSize: null, mediaModes: { tv: false, full: false }, updatedAt: 1, deleted: false },
      '4': { id: 4, animeThemesAnimeId: 3, kitsuAnimeIds: ['anime-3'], title: 'Opening 3', themeType: 'OP', artists: [], audioUrl: '', videoUrl: null, audioState: 'READY', durationSeconds: null, fileSize: null, mediaModes: { tv: false, full: false }, updatedAt: 1, deleted: false },
    } as NormalizedLibrary['themesById']

    const urls = playlistArtworkUrls({ id: 9, name: 'Mix', entries: [], defaultMode: 'TV_SIZE', overrideUserPreference: false, items: [
      { entryId: 1, itemType: 'THEME', itemId: 1, modeOverride: null },
      { entryId: 2, itemType: 'THEME', itemId: 2, modeOverride: null },
      { entryId: 3, itemType: 'THEME', itemId: 3, modeOverride: null },
      { entryId: 4, itemType: 'THEME', itemId: 4, modeOverride: null },
    ], isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 1, deleted: false, dynamicSpecJson: null, dynamicSortJson: null }, library)

    expect(urls).toEqual(['/api/same.jpg', '/api/other.jpg'])
    render(<PlaylistArtwork playlistId={11} name="Mix" artworkUrls={['/same.jpg', '/same.jpg', '/other.jpg', '/other.jpg']} />)
    expect(screen.getByTestId('playlist-artwork-11').querySelectorAll('img')).toHaveLength(2)
  })

  it('overrides the shared compact thumbnail height so catalog collages stay square', () => {
    expect(playlistCss).toMatch(/\.playlist-artwork\s*\{[^}]*width:\s*100%[^}]*height:\s*auto[^}]*aspect-ratio:\s*1/)
  })
})
