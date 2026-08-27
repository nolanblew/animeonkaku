import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryThemeDto, MusicReleaseDto, MusicTrackDto, NormalizedLibrary, PlaylistDto } from '../lib/library'

const captures = vi.hoisted(() => ({
  animeProps: null as any,
  releaseProps: null as any,
  libraryProps: null as any,
  searchProps: null as any,
  playlistDetailProps: null as any,
  playlistManagerProps: null as any,
  playlistQuery: null as any,
  playlistsQuery: null as any,
  mutations: null as any,
  libraryQuery: null as any,
  player: null as any,
}))

vi.mock('../features/catalog', () => ({
  HomeCatalogPage: () => <h2>Mock home catalog</h2>,
  LibraryCatalogPage: (props: unknown) => { captures.libraryProps = props; return <h2>Mock library catalog</h2> },
  AnimeDetailPage: (props: unknown) => { captures.animeProps = props; return <h2>Mock anime detail</h2> },
}))

vi.mock('../features/accountsearch', () => ({
  SearchPage: (props: unknown) => { captures.searchProps = props; return <h2>Mock search</h2> },
  SettingsPage: () => <h2>Mock account settings</h2>,
}))

vi.mock('../features/releases', () => ({
  ReleaseDetailPage: (props: unknown) => { captures.releaseProps = props; return <h2>Mock release detail</h2> },
}))

vi.mock('../features/playlists', () => ({
  PlaylistDetail: (props: unknown) => { captures.playlistDetailProps = props; return <h2>Mock playlist detail</h2> },
  PlaylistFeatureMessage: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  PlaylistManager: (props: unknown) => { captures.playlistManagerProps = props; return <h2>Mock playlist manager</h2> },
  usePlaylist: () => captures.playlistQuery,
  usePlaylists: () => captures.playlistsQuery,
  usePlaylistMutations: () => captures.mutations,
}))

vi.mock('../lib/query', () => ({ useLibraryQuery: () => captures.libraryQuery }))

vi.mock('../player', async (importOriginal) => {
  const original = await importOriginal<typeof import('../player')>()
  return { ...original, usePlayer: () => captures.player, NowPlayingView: () => <h2>Mock now playing</h2> }
})

import { AnimePage, HomePage, LibraryPage, NowPlayingPage, PlaylistPage, PlaylistsPage, ReleasePage, SearchPage, SettingsPage } from './Pages'

const opening = theme(11, 'anime-1', 'Opening')
const ending = theme(12, 'anime-1', 'Ending')
const song: MusicTrackDto = {
  id: 90,
  title: 'Full song',
  titleEnglish: null,
  titleRomaji: null,
  titleJapanese: null,
  artistCredit: 'Band',
  artistNames: [],
  durationSeconds: 240,
  audioUrl: '/v1/media/audio/song-90',
  fileSize: null,
  discNumber: 1,
  trackNumber: 1,
  displayOrder: 1,
}
const release: MusicReleaseDto = {
  id: 42,
  title: 'Release album',
  titleEnglish: null,
  titleRomaji: null,
  titleJapanese: null,
  artistCredit: 'Band',
  artistNames: [],
  relationshipType: 'SOUNDTRACK',
  releaseDate: '2024-01-01',
  year: 2024,
  artworkUrl: '/cover.jpg',
  tracks: [song, { ...song, id: 91, title: 'Second song', displayOrder: 2, trackNumber: 2 }],
  anime: [{ kitsuId: 'anime-1', title: 'Anime one', titleEn: null, posterUrl: null, relationshipType: 'SOUNDTRACK' }],
}
const playlist: PlaylistDto = {
  id: 7,
  name: 'Mixed modes',
  entries: [],
  items: [
    { entryId: 1, itemType: 'THEME', itemId: 11, modeOverride: null },
    { entryId: 2, itemType: 'SONG', itemId: 90, modeOverride: null },
    { entryId: 3, itemType: 'THEME', itemId: 999, modeOverride: null },
    { entryId: 4, itemType: 'SONG', itemId: 999, modeOverride: null },
  ],
  defaultMode: 'FULL_SIZE',
  overrideUserPreference: false,
  isAuto: false,
  isDynamic: false,
  autoUpdate: false,
  updatedAt: 1,
  deleted: false,
  dynamicSpecJson: null,
  dynamicSortJson: null,
}
const library: NormalizedLibrary = {
  cursor: 1,
  animeById: {
    'anime-1': {
      kitsuId: 'anime-1', animeThemesId: 51, title: 'Anime one', titleEn: null, titleRomaji: null, titleJa: null,
      posterUrl: '/v1/media/artwork/anime-1', coverUrl: null, watchingStatus: 'current', subtype: 'TV', startDate: null,
      endDate: null, episodeCount: 12, ageRating: null, averageRating: null, userRating: null, libraryUpdatedAt: 1,
      slug: 'anime-one', genres: [], updatedAt: 1, deleted: false,
    },
  },
  themesById: { '11': opening, '12': ending },
  prefsByThemeId: { '11': { themeId: 11, liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false, preferredMode: 'TV_SIZE', playCount: 0, lastPlayedAt: null, updatedAt: 1, deleted: false } },
  songPrefsById: {},
  playlistsById: { '7': playlist },
  musicCatalogByAnimeId: {
    'anime-1': { anime: { kitsuId: 'anime-1', title: 'Anime one', titleEn: null, posterUrl: null }, releases: [{ id: 1, title: 'Release', titleEnglish: null, titleRomaji: null, titleJapanese: null, artistCredit: 'Band', artistNames: [], relationshipType: 'THEME', releaseDate: null, year: 2020, artworkUrl: '/cover.jpg', tracks: [song] }] },
  },
}

function playerMock(currentItem: unknown = { id: 'current' }) {
  return {
    currentItem,
    playTheme: vi.fn(),
    playSong: vi.fn(),
    playItem: vi.fn(),
    playItems: vi.fn(),
    setShuffle: vi.fn(),
    queue: { addToQueue: vi.fn(), playNext: vi.fn() },
  }
}

function renderPath(element: React.ReactElement, path = '/', route = '*') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /><Route path="/playlists" element={<h2>Playlist destination</h2>} /></Routes></MemoryRouter>)
}

beforeEach(() => {
  captures.player = playerMock()
  captures.libraryQuery = { library }
  captures.mutations = { create: vi.fn(), update: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) }
  captures.playlistQuery = { isPending: false, isError: false, playlist }
  captures.playlistsQuery = { isPending: false, isError: false, playlists: [playlist] }
})

describe('page-to-player wiring', () => {
  it('renders the simple route adapters', () => {
    renderPath(<HomePage />)
    expect(screen.getByText('Mock home catalog')).toBeInTheDocument()
    renderPath(<NowPlayingPage />)
    expect(screen.getByText('Mock now playing')).toBeInTheDocument()
    renderPath(<SettingsPage />)
    expect(screen.getByText('Mock account settings')).toBeInTheDocument()
  })

  it('connects library play, play-next, append, and empty-queue bootstrapping', () => {
    renderPath(<LibraryPage />)
    captures.libraryProps.onPlayTheme(opening, '/art.jpg')
    expect(captures.player.playTheme).toHaveBeenCalledWith(opening, { artworkUrl: '/api/art.jpg' })
    captures.libraryProps.onPlayNext(opening, '/art.jpg')
    captures.libraryProps.onAddToQueue(ending, '/art.jpg')
    expect(captures.player.queue.playNext).toHaveBeenCalledTimes(1)
    expect(captures.player.queue.addToQueue).toHaveBeenCalledTimes(1)

    captures.player.currentItem = null
    captures.libraryProps.onPlayNext(opening, null)
    expect(captures.player.playItem).toHaveBeenCalledWith(expect.objectContaining({ themeId: 11 }), { contextLabel: 'Queue' })
  })

  it('connects anime collection playback, shuffle, insertion, and full songs', () => {
    renderPath(<AnimePage />)
    captures.animeProps.onPlayThemes([], 0, false, null)
    captures.animeProps.onPlayThemes([opening, ending], 1, true, '/poster.jpg')
    expect(captures.player.playItems).toHaveBeenCalledWith([
      expect.objectContaining({ themeId: 11, artworkUrl: '/api/poster.jpg' }),
      expect.objectContaining({ themeId: 12, artworkUrl: '/api/poster.jpg' }),
    ], { contextLabel: 'Anime themes', startIndex: 1, shuffle: true })
    captures.animeProps.onPlayNext([opening, ending], '/poster.jpg')
    captures.animeProps.onAddToQueue([ending], '/poster.jpg')
    captures.animeProps.onPlaySong(song, '/cover.jpg', 'anime-1')
    captures.animeProps.onPlayNextSong(song, release, 'anime-1')
    captures.animeProps.onAddToQueueSong(song, release, 'anime-1')
    captures.animeProps.onReplaceQueueSong(song, release, 'anime-1')
    expect(captures.player.queue.playNext).toHaveBeenCalled()
    expect(captures.player.playSong).toHaveBeenCalledWith(song, { artworkUrl: '/api/cover.jpg', animeId: 'anime-1' })
    expect(captures.player.queue.playNext).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.queue.addToQueue).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.playItems).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })], { contextLabel: 'Release album', startIndex: 0, shuffle: false })
  })

  it('connects release album playback and individual song playback', () => {
    renderPath(<ReleasePage />, '/release/42', '/release/:releaseId')
    expect(screen.getByText('Mock release detail')).toBeInTheDocument()

    captures.releaseProps.onPlayAll(release, false)
    expect(captures.player.playItems).toHaveBeenCalledWith([
      expect.objectContaining({ songId: 90 }),
      expect.objectContaining({ songId: 91 }),
    ], { contextLabel: 'Release album', startIndex: 0, shuffle: false })
    captures.releaseProps.onPlayAll(release, true)
    expect(captures.player.playItems).toHaveBeenLastCalledWith(expect.any(Array), { contextLabel: 'Release album', startIndex: 0, shuffle: true })
    captures.releaseProps.onPlayTrack(release.tracks[1], release, 1)
    expect(captures.player.playItems).toHaveBeenLastCalledWith([
      expect.objectContaining({ songId: 90 }),
      expect.objectContaining({ songId: 91 }),
    ], { contextLabel: 'Release album', startIndex: 1, shuffle: false })
    captures.releaseProps.onPlayNextTrack(song, release)
    captures.releaseProps.onAddToQueueTrack(song, release)
    captures.releaseProps.onReplaceQueueTrack(song, release)
    expect(captures.player.queue.playNext).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.queue.addToQueue).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.playItems).toHaveBeenLastCalledWith([expect.objectContaining({ songId: 90 })], { contextLabel: 'Release album', startIndex: 0, shuffle: false })
  })

  it('only forwards playable search results and resolves library artwork', () => {
    renderPath(<SearchPage />)
    captures.searchProps.onPlayTheme(opening)
    expect(captures.player.playTheme).toHaveBeenCalledWith(opening, { artworkUrl: '/api/v1/media/artwork/anime-1', animeId: 'anime-1' })
    captures.searchProps.onPlayTrack({ track: null })
    captures.searchProps.onPlayTrack({ track: { id: 'bad' } })
    captures.searchProps.onPlayTrack({ anime: { kitsuId: 'anime-1', posterUrl: '/search.jpg' }, track: { id: 90, title: 'Full song', audioUrl: '/song', artistCredit: 'Band', durationSeconds: 200 } })
    expect(captures.player.playSong).toHaveBeenCalledWith(expect.objectContaining({ id: 90, audioUrl: '/song' }), { artworkUrl: '/api/search.jpg', animeId: 'anime-1' })
    const searchResult = { anime: { kitsuId: 'anime-1', posterUrl: '/search.jpg' }, releaseTitle: 'Search album', track: { id: 90, title: 'Full song', audioUrl: '/song', artistCredit: 'Band', durationSeconds: 200 } }
    captures.searchProps.onPlayNextTrack(searchResult)
    captures.searchProps.onAddToQueueTrack(searchResult)
    captures.searchProps.onReplaceQueueTrack(searchResult)
    expect(captures.player.queue.playNext).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.queue.addToQueue).toHaveBeenCalledWith([expect.objectContaining({ songId: 90 })])
    expect(captures.player.playItems).toHaveBeenLastCalledWith([expect.objectContaining({ songId: 90 })], { contextLabel: 'Search album', startIndex: 0, shuffle: false })
  })

  it('renders each playlist route state and deletes back to the collection', async () => {
    renderPath(<PlaylistPage />, '/playlist/nope', '/playlist/:playlistId')
    expect(screen.getByText('Playlist not found')).toBeInTheDocument()

    captures.playlistQuery = { isPending: true, isError: false, playlist: null }
    renderPath(<PlaylistPage />, '/playlist/7', '/playlist/:playlistId')
    expect(screen.getByText(/loading playlist/i)).toBeInTheDocument()
    captures.playlistQuery = { isPending: false, isError: true, playlist: null }
    renderPath(<PlaylistPage />, '/playlist/7', '/playlist/:playlistId')
    expect(screen.getByText(/could not load/i)).toBeInTheDocument()
    captures.playlistQuery = { isPending: false, isError: false, playlist: null }
    renderPath(<PlaylistPage />, '/playlist/7', '/playlist/:playlistId')
    expect(screen.getAllByText('Playlist not found').length).toBeGreaterThan(0)

    captures.playlistQuery = { isPending: false, isError: false, playlist }
    renderPath(<PlaylistPage />, '/playlist/7', '/playlist/:playlistId')
    captures.playlistDetailProps.onPlay(playlist, true)
    expect(captures.player.playItems).toHaveBeenCalledWith([
      expect.objectContaining({ themeId: 11, mode: 'TV_SIZE' }),
      expect.objectContaining({ songId: 90 }),
    ], { contextLabel: 'Mixed modes', startIndex: 0, shuffle: true })

    const withUnavailableBeforeSelection = {
      ...playlist,
      items: [
        { entryId: 1, itemType: 'THEME' as const, itemId: 11, modeOverride: null },
        { entryId: 2, itemType: 'THEME' as const, itemId: 999, modeOverride: null },
        { entryId: 3, itemType: 'THEME' as const, itemId: 12, modeOverride: null },
        { entryId: 4, itemType: 'SONG' as const, itemId: 90, modeOverride: null },
      ],
    }
    captures.playlistDetailProps.onPlayItem(withUnavailableBeforeSelection, 3)
    expect(captures.player.playItems).toHaveBeenLastCalledWith([
      expect.objectContaining({ themeId: 11 }),
      expect.objectContaining({ themeId: 12 }),
      expect.objectContaining({ songId: 90 }),
    ], { contextLabel: 'Mixed modes', startIndex: 2, shuffle: false })
    await act(async () => captures.playlistDetailProps.onDelete(7))
    expect(screen.getByText('Playlist destination')).toBeInTheDocument()
  })

  it('connects the playlist collection and supports legacy entry arrays', () => {
    const legacy = { ...playlist, items: [], entries: [11], overrideUserPreference: true }
    captures.playlistsQuery = { isPending: false, isError: false, playlists: [legacy] }
    renderPath(<PlaylistsPage />)
    expect(captures.playlistManagerProps.state).toBe('ready')
    captures.playlistManagerProps.onPlay(legacy, false)
    expect(captures.player.playItems).toHaveBeenCalledWith([expect.objectContaining({ themeId: 11, mode: 'FULL_SIZE' })], { contextLabel: 'Mixed modes', startIndex: 0, shuffle: false })
  })
})

function theme(id: number, animeId: string, title: string): LibraryThemeDto {
  return {
    id, animeThemesAnimeId: 51, kitsuAnimeIds: [animeId], title, themeType: 'OP', artists: [], audioUrl: `/audio/${id}`,
    videoUrl: null, audioState: 'READY', durationSeconds: 90, fileSize: null,
    mediaModes: { tvSize: { url: `/audio/${id}`, durationSeconds: 90, fileSize: null }, fullSize: { songId: 100 + id, url: `/full/${id}`, durationSeconds: 240, fileSize: null, sourceReleaseId: null }, video: null },
    updatedAt: 1, deleted: false,
  }
}
