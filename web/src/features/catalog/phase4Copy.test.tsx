import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedLibrary } from '../../lib/library'
import { createEmptyLibrary } from '../../lib/library'

vi.mock('../../lib/query', () => ({
  useLibraryQuery: () => ({ library: libraryFixture(), status: 'success', isPending: false, isError: false, isSuccess: true, error: null }),
}))

import { LibraryCatalogPage } from './LibraryCatalogPage'

function libraryFixture(): NormalizedLibrary {
  const base = createEmptyLibrary()
  return {
    ...base,
    animeById: {
      'anime-9': {
        kitsuId: 'anime-9', animeThemesId: 9, title: 'Runtime QA Anthology', titleEn: 'Runtime QA Anthology', titleRomaji: null, titleJa: null,
        posterUrl: null, coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null, endDate: null, episodeCount: 12,
        ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1, slug: 'runtime-qa-anthology', genres: [], updatedAt: 1, deleted: false,
      },
    },
  }
}

describe('phase 4 library copy and URL contracts', () => {
  it('uses the user-facing singular label Anime for the collection tab and stat', () => {
    render(<MemoryRouter initialEntries={['/library']}><LibraryCatalogPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'Anime' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Animes' })).not.toBeInTheDocument()
    expect(screen.getByText('Anime', { selector: '.catalog-page__stat span' })).toBeInTheDocument()
  })

  it('makes the Home See all songs destination select the Songs library tab', () => {
    render(<MemoryRouter initialEntries={['/library?tab=songs']}><LibraryCatalogPage /></MemoryRouter>)

    expect(screen.getByRole('tab', { name: 'Songs' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: 'Filter songs' })).toBeInTheDocument()
  })
})
