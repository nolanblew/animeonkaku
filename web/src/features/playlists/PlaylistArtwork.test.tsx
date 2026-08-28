import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlaylistArtwork } from './PlaylistArtwork'
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

  it('overrides the shared compact thumbnail height so catalog collages stay square', () => {
    expect(playlistCss).toMatch(/\.playlist-artwork\s*\{[^}]*width:\s*100%[^}]*height:\s*auto[^}]*aspect-ratio:\s*1/)
  })
})
