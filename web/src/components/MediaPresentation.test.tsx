import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MediaArtwork, MediaCard, MediaListItem } from './MediaPresentation'

describe('shared media presentation', () => {
  it('renders one image, a playlist mosaic, and an accessible empty fallback', () => {
    const { rerender } = render(<MediaArtwork imageUrl="/poster.jpg" label="Anime poster" />)
    expect(screen.getByTestId('media-artwork').querySelector('img')).toHaveAttribute('src', '/api/poster.jpg')
    expect(screen.getByTestId('media-artwork')).toHaveAttribute('data-layout', 'single')

    rerender(<MediaArtwork imageUrls={['/one.jpg', '/two.jpg', '/three.jpg', '/four.jpg']} label="Playlist artwork" />)
    expect(screen.getByTestId('media-artwork').querySelectorAll('img')).toHaveLength(4)
    expect(screen.getByTestId('media-artwork')).toHaveAttribute('data-layout', 'quad')

    rerender(<MediaArtwork label="Empty playlist artwork" />)
    expect(screen.getByLabelText('Empty playlist artwork')).toBeInTheDocument()
    expect(screen.getByTestId('media-artwork')).toHaveAttribute('data-layout', 'empty')
  })

  it('shares linked row and card semantics while leaving room for feature actions', () => {
    render(
      <MemoryRouter>
        <MediaListItem href="/anime/1" title="Anime title" subtitle="Opening 1" imageUrl="/row.jpg" actions={<button type="button">More</button>} />
        <MediaCard href="/playlist/2" title="Playlist title" subtitle="12 tracks" imageUrls={['/one.jpg', '/two.jpg']} actions={<button type="button">Playlist actions</button>} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Anime title/i })).toHaveAttribute('href', '/anime/1')
    expect(screen.getByRole('link', { name: /Playlist title/i })).toHaveAttribute('href', '/playlist/2')
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Playlist actions' })).toBeInTheDocument()
    expect(screen.getAllByTestId('media-artwork')).toHaveLength(2)
  })
})
