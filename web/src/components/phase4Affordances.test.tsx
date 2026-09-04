import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryThemeDto, NormalizedLibrary } from '../lib/library'
import { createEmptyLibrary } from '../lib/library'

vi.mock('../lib/query', async () => ({
  ...await vi.importActual<typeof import('../lib/query')>('../lib/query'),
  useLibraryQuery: () => ({ library: libraryFixture(), status: 'success', isPending: false, isError: false, isSuccess: true, error: null }),
}))

import { ResponsiveShell } from './ResponsiveShell'
import { HomeCatalogPage } from '../features/catalog/HomeCatalogPage'
import { PlayerProvider, QueueStore } from '../player'

function libraryFixture(): NormalizedLibrary {
  const base = createEmptyLibrary()
  return {
    ...base,
    animeById: {
      'anime-9': {
        kitsuId: 'anime-9', animeThemesId: 9, title: 'Runtime QA Anthology', titleEn: 'Runtime QA Anthology', titleRomaji: null, titleJa: null,
        posterUrl: '/images/anime-9.jpg', coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null, endDate: null, episodeCount: 12,
        ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1, slug: 'runtime-qa-anthology', genres: [], updatedAt: 1, deleted: false,
      },
    },
    themesById: { '41': themeFixture() },
  }
}

function themeFixture(): LibraryThemeDto {
  return {
    id: 41,
    animeThemesAnimeId: 9,
    kitsuAnimeIds: ['anime-9'],
    title: 'Signal in Violet',
    themeType: 'OP1',
    artists: [],
    audioUrl: '/v1/media/audio/41',
    videoUrl: null,
    audioState: 'READY',
    durationSeconds: 90,
    fileSize: null,
    mediaModes: { tvSize: { url: '/v1/media/audio/41', durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
    updatedAt: 1,
    deleted: false,
  }
}

function homeFixture() {
  return {
    serverTime: 1,
    continueWatching: [{ kitsuId: 'anime-9', title: 'Runtime QA Anthology', posterUrl: '/images/anime-9.jpg', updatedAt: 1 }],
    recentlyAdded: [],
    playlists: [],
    nextCursor: null,
  }
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['home'], homeFixture())
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><HomeCatalogPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('phase 4 affordance contracts', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens a real action menu from each Home quick pick overflow control', async () => {
    renderHome()

    const recommended = await screen.findByRole('region', { name: 'Recommended' })
    const more = within(recommended).getByRole('button', { name: 'More actions for Signal in Violet' })
    await userEvent.click(more)

    expect(screen.getByRole('menu', { name: 'Signal in Violet actions' })).toBeInTheDocument()
  })

  it('does not render a notifications control without a notification model', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/library']}>
          <PlayerProvider queueStore={new QueueStore()}>
            <ResponsiveShell><h1>Library content</h1></ResponsiveShell>
          </PlayerProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Notifications' })).not.toBeInTheDocument()
  })
})
