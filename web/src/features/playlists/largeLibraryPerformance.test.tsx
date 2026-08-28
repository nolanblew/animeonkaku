import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LibraryAnimeDto, LibraryThemeDto, NormalizedLibrary, PlaylistDto } from '../../lib/library'
import { PlaylistDetail } from './components'

const LARGE_PLAYLIST_SIZE = 1_000
const MAX_INITIAL_ROWS = 48

describe('large playlist browser performance', () => {
  it('mounts only a bounded window for a thousand-track playlist', () => {
    const library = createLargeLibrary(LARGE_PLAYLIST_SIZE)
    const playlist = createLargePlaylist(LARGE_PLAYLIST_SIZE)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PlaylistDetail
          playlist={playlist}
          library={library}
          onUpdate={() => undefined}
          onDelete={() => undefined}
          onPlayItem={() => undefined}
          onPlayNextItem={() => undefined}
          onAddToQueueItem={() => undefined}
        />
      </QueryClientProvider>,
    )

    const mountedRows = container.querySelectorAll('.playlist-track-list > li').length
    expect(mountedRows).toBeLessThanOrEqual(MAX_INITIAL_ROWS)
    expect(mountedRows).toBeGreaterThan(0)
  })
})

function createLargeLibrary(size: number): NormalizedLibrary {
  const anime: LibraryAnimeDto = {
    kitsuId: 'scale-anime', animeThemesId: 1, title: 'Scale Test Anime', titleEn: 'Scale Test Anime',
    titleRomaji: null, titleJa: null, posterUrl: null, coverUrl: null, watchingStatus: 'CURRENT',
    subtype: 'TV', startDate: null, endDate: null, episodeCount: 12, ageRating: null, averageRating: null,
    userRating: null, libraryUpdatedAt: 1, slug: 'scale-test-anime', genres: [], updatedAt: 1, deleted: false,
  }
  const themes = Object.fromEntries(Array.from({ length: size }, (_, index) => {
    const id = index + 1
    const theme: LibraryThemeDto = {
      id, animeThemesAnimeId: 1, kitsuAnimeIds: ['scale-anime'], title: `Scale Theme ${id}`, themeType: 'OP',
      artists: [], audioUrl: `/v1/media/audio/${id}`, videoUrl: null, audioState: 'READY', durationSeconds: 90,
      fileSize: null, mediaModes: { tvSize: { url: `/v1/media/audio/${id}`, durationSeconds: 90, fileSize: null }, fullSize: null, video: null },
      updatedAt: id, deleted: false,
    }
    return [String(id), theme]
  }))
  return {
    cursor: size, animeById: { 'scale-anime': anime }, themesById: themes,
    prefsByThemeId: {}, songPrefsById: {}, playlistsById: {}, musicCatalogByAnimeId: {},
  }
}

function createLargePlaylist(size: number): PlaylistDto {
  return {
    id: 901, name: 'Scale Test Playlist', entries: [], defaultMode: 'TV_SIZE', overrideUserPreference: false,
    items: Array.from({ length: size }, (_, index) => ({ entryId: index + 1, itemType: 'THEME' as const, itemId: index + 1, modeOverride: null })),
    isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 1, deleted: false,
    dynamicSpecJson: null, dynamicSortJson: null,
  }
}
