import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { LibraryAnimeDto } from '../../lib/library'
import { AnimeGrid } from './AnimeGrid'

function anime(index: number): LibraryAnimeDto {
  return {
    kitsuId: String(index),
    animeThemesId: null,
    title: `Anime ${index}`,
    titleEn: null,
    titleRomaji: null,
    titleJa: null,
    posterUrl: null,
    coverUrl: null,
    watchingStatus: 'current',
    subtype: 'TV',
    startDate: null,
    endDate: null,
    episodeCount: null,
    ageRating: null,
    averageRating: null,
    userRating: null,
    libraryUpdatedAt: null,
    slug: null,
    genres: [],
    updatedAt: 1,
    deleted: false,
  }
}

describe('AnimeGrid', () => {
  it('keeps a fixed-size DOM window while paging through very large libraries', async () => {
    render(<MemoryRouter><AnimeGrid anime={Array.from({ length: 7 }, (_, index) => anime(index))} pageSize={3} /></MemoryRouter>)

    expect(screen.getAllByTestId('anime-card')).toHaveLength(3)
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next anime page' }))
    expect(screen.getAllByTestId('anime-card')).toHaveLength(3)
    expect(screen.queryByRole('link', { name: 'Anime 0' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Anime 3' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next anime page' }))
    expect(screen.getAllByTestId('anime-card')).toHaveLength(1)
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
  })
})
