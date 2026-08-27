import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ListMusic, MonitorPlay } from 'lucide-react'
import { RouteSkeleton } from '../components/RouteSkeleton'
import { AnimeDetailPage, HomeCatalogPage, LibraryCatalogPage } from '../features/catalog'
import { ArtistDetailPage, type ArtistDetailResponse } from '../features/artists'
import { RelatedMusicPage as RelatedMusicFeaturePage } from '../features/relatedmusic'
import { ReleaseDetailPage } from '../features/releases'
import { PlaylistDetail, PlaylistFeatureMessage, PlaylistManager, usePlaylist, usePlaylistMutations, usePlaylists } from '../features/playlists'
import { SearchPage as AccountSearchPage, SettingsPage as AccountSettingsPage, type MusicSearchTrack } from '../features/accountsearch'
import { mapSongToQueueItem, mapThemeToQueueItem, NowPlayingView, runPlayerViewTransition, usePlayer, type PlayerContextValue, type PlayerQueueItem } from '../player'
import type { LibraryThemeDto, MusicReleaseDto, MusicTrackDto, NormalizedLibrary, PlaylistDto } from '../lib/library'
import { browserAssetUrl } from '../lib/assets'
import { useLibraryQuery } from '../lib/query'

export function HomePage() {
  const player = usePlayer()
  return <HomeCatalogPage onPlayTheme={(theme, artworkUrl) => player.playTheme(theme, { artworkUrl: resolveBrowserAsset(artworkUrl) })} />
}

export function LibraryPage() {
  const player = usePlayer()
  return <LibraryCatalogPage onPlayTheme={(theme, artworkUrl) => player.playTheme(theme, { artworkUrl: resolveBrowserAsset(artworkUrl) })} onPlayNext={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'next', artworkUrl)} onAddToQueue={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'append', artworkUrl)} />
}

export function SearchPage() {
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <AccountSearchPage onPlayTheme={(theme) => {
    const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find(Boolean)
    player.playTheme(theme, { artworkUrl: browserAssetUrl(anime?.posterUrl), animeId: anime?.kitsuId })
  }} onPlayTrack={(result) => playSearchTrack(player.playSong, result)} />
}

export function AnimePage() {
  const player = usePlayer()
  const playThemes = (themes: LibraryThemeDto[], startIndex = 0, shuffle = false, artworkUrl?: string | null) => playThemeCollection(player, themes, startIndex, shuffle, artworkUrl)
  return <AnimeDetailPage onPlayThemes={playThemes} onPlayNext={(themes, artworkUrl) => insertThemeCollection(player, themes, 'next', artworkUrl)} onAddToQueue={(themes, artworkUrl) => insertThemeCollection(player, themes, 'append', artworkUrl)} onPlaySong={(song, artworkUrl, animeId) => player.playSong(song, { artworkUrl: resolveBrowserAsset(artworkUrl), animeId })} />
}

export function ArtistPage() {
  const player = usePlayer()
  return <ArtistDetailPage onPlayAll={(artist, shuffle) => playArtistCollection(player, artist, shuffle)} onPlayItem={(artist, startIndex) => playArtistCollection(player, artist, false, startIndex)} />
}

export function RelatedMusicPage() {
  return <RelatedMusicFeaturePage />
}

export function ReleasePage() {
  const player = usePlayer()
  return <ReleaseDetailPage onPlayAll={(release, shuffle) => playReleaseCollection(player, release, shuffle)} onPlayTrack={(track, release, startIndex) => playReleaseTrack(player, track, release, startIndex)} />
}

export function PlaylistPage() {
  const { playlistId } = useParams()
  const navigate = useNavigate()
  const id = playlistId && /^\d+$/.test(playlistId) ? Number(playlistId) : null
  const query = usePlaylist(id)
  const mutations = usePlaylistMutations()
  const player = usePlayer()
  const library = useLibraryQuery().library
  if (id === null) return <RouteSkeleton eyebrow="Playlist" title="Playlist not found" description="Open a playlist from your library to continue." icon={ListMusic} />
  if (query.isPending) return <PlaylistFeatureMessage>Loading playlist…</PlaylistFeatureMessage>
  if (query.isError) return <PlaylistFeatureMessage>Could not load this playlist. Try again in a moment.</PlaylistFeatureMessage>
  if (!query.playlist) return <RouteSkeleton eyebrow="Playlist" title="Playlist not found" description="This playlist may have been removed on another device." icon={ListMusic} />
  return <PlaylistDetail playlist={query.playlist} library={library} onUpdate={mutations.update} onDelete={async (playlist) => { await mutations.remove(playlist); navigate('/playlists', { replace: true }) }} onBack={() => navigate('/playlists')} onPlay={library ? (playlist, shuffle) => playPlaylist(player, library, playlist, shuffle) : undefined} onPlayItem={library ? (playlist, index) => playPlaylist(player, library, playlist, false, index) : undefined} onPlayNextItem={library ? (playlist, index) => enqueuePlaylistItem(player, library, playlist, index, 'next') : undefined} onAddToQueueItem={library ? (playlist, index) => enqueuePlaylistItem(player, library, playlist, index, 'append') : undefined} onPlayNext={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'next') : undefined} onAddToQueue={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'append') : undefined} onReplaceQueue={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'replace') : undefined} onRefresh={(playlist) => mutations.refresh(playlist.id)} />
}

export function PlaylistsPage() {
  const [searchParams] = useSearchParams()
  const query = usePlaylists()
  const mutations = usePlaylistMutations()
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <section className="page" aria-labelledby="playlists-page-title"><h1 id="playlists-page-title" className="sr-only">Playlists</h1><PlaylistManager playlists={query.playlists} state={query.isPending ? 'loading' : query.isError ? 'error' : query.playlists.length === 0 ? 'empty' : 'ready'} error={query.isError ? 'Could not load playlists.' : undefined} initialCreate={searchParams.get('create') === '1'} onCreate={mutations.create} onUpdate={mutations.update} onDelete={mutations.remove} onPlay={library ? (playlist, shuffle) => playPlaylist(player, library, playlist, shuffle) : undefined} /></section>
}

export function NowPlayingPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const playerReturnTo = (location.state as { playerReturnTo?: string } | null)?.playerReturnTo ?? '/'
  return <section className="now-playing-route" aria-labelledby="now-playing-title"><h1 id="now-playing-title" className="sr-only">Now playing</h1><NowPlayingView onCollapse={() => runPlayerViewTransition(() => navigate(playerReturnTo, { replace: true }))} /></section>
}

export function SettingsPage() {
  return <AccountSettingsPage />
}

function playSearchTrack(playSong: (song: MusicTrackDto, options?: { artworkUrl?: string | null; animeId?: string | number | null }) => void, result: MusicSearchTrack): void {
  const track = result.track
  if (!track || typeof track.id !== 'number' || !track.audioUrl || !track.title) return
  playSong({
    id: track.id,
    title: track.title,
    titleEnglish: null,
    titleRomaji: null,
    titleJapanese: null,
    artistCredit: track.artistCredit ?? '',
    artistNames: [],
    durationSeconds: track.durationSeconds ?? null,
    audioUrl: track.audioUrl,
    fileSize: null,
    discNumber: 1,
    trackNumber: null,
    displayOrder: 0,
  }, { artworkUrl: resolveBrowserAsset(result.anime?.posterUrl), animeId: result.anime?.kitsuId })
}

function playReleaseCollection(player: PlayerContextValue, release: MusicReleaseDto, shuffle: boolean, startIndex = 0): void {
  const artworkUrl = resolveBrowserAsset(release.artworkUrl)
  const animeId = release.anime?.find((anime) => anime.kitsuId)?.kitsuId
  const items = release.tracks.map((track) => mapSongToQueueItem(track, { artworkUrl, animeId }))
  if (items.length === 0) return
  player.playItems(items, { contextLabel: release.title, startIndex, shuffle })
}

function playReleaseTrack(player: PlayerContextValue, _track: MusicTrackDto, release: MusicReleaseDto, startIndex = 0): void {
  playReleaseCollection(player, release, false, startIndex)
}

function playArtistCollection(player: PlayerContextValue, artist: ArtistDetailResponse, shuffle: boolean, startIndex = 0): void {
  const artworkUrl = resolveBrowserAsset(artist.artist.artworkUrl)
  const themes = Array.isArray(artist.themes) ? artist.themes : []
  const songs = Array.isArray(artist.fullSongs) ? artist.fullSongs.filter((song) => song.audioAvailable !== false && Boolean(song.audioUrl)) : []
  const items = [
    ...themes.map((theme) => mapThemeToQueueItem(theme as LibraryThemeDto, { artworkUrl })),
    ...songs.map((song) => mapSongToQueueItem(song as MusicTrackDto, { artworkUrl })),
  ]
  if (items.length === 0) return
  const boundedStartIndex = Math.max(0, Math.min(startIndex, Math.max(0, items.length - 1)))
  player.playItems(items, { contextLabel: artist.artist.name || 'Artist', startIndex: boundedStartIndex, shuffle })
}

function playThemeCollection(player: PlayerContextValue, themes: LibraryThemeDto[], startIndex: number, shuffle: boolean, artworkUrl?: string | null): void {
  const items = themes.map((theme) => mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(artworkUrl) }))
  if (items.length === 0) return
  player.playItems(items, { contextLabel: themes.length === 1 ? themes[0]?.title : 'Anime themes', startIndex, shuffle })
}

function insertThemeCollection(player: PlayerContextValue, themes: LibraryThemeDto[], position: 'next' | 'append', artworkUrl?: string | null): void {
  const items = themes.map((theme) => mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(artworkUrl) }))
  if (items.length === 0) return
  if (!player.currentItem) {
    player.playItem(items[0]!, { contextLabel: 'Queue' })
    if (items.length > 1) player.queue.addToQueue(items.slice(1))
    return
  }
  if (position === 'next') player.queue.playNext(items)
  else player.queue.addToQueue(items)
}

function resolveBrowserAsset(value: string | null | undefined): string | undefined {
  return browserAssetUrl(value)
}

function playPlaylist(player: PlayerContextValue, library: NormalizedLibrary, playlist: PlaylistDto, shuffle: boolean, startIndex = 0): void {
  const queueItems = playlistQueueItems(library, playlist)
  const boundedSourceIndex = Math.max(0, Math.min(startIndex, Math.max(0, queueItems.length - 1)))
  const playableItems = queueItems.filter((item): item is PlayerQueueItem => item !== null)
  if (playableItems.length === 0) return
  const playableStartIndex = Math.max(0, queueItems.slice(0, boundedSourceIndex + 1).filter((item): item is PlayerQueueItem => item !== null).length - 1)
  player.playItems(playableItems, { contextLabel: playlist.name, startIndex: playableStartIndex, shuffle })
}

function enqueuePlaylistItem(player: PlayerContextValue, library: NormalizedLibrary, playlist: PlaylistDto, index: number, position: 'next' | 'append'): void {
  const item = playlistQueueItems(library, playlist)[index]
  if (!item) return
  if (!player.currentItem) { player.playItem(item, { contextLabel: playlist.name }); return }
  if (position === 'next') player.queue.playNext([item])
  else player.queue.addToQueue([item])
}

function enqueuePlaylistCollection(player: PlayerContextValue, library: NormalizedLibrary, playlist: PlaylistDto, position: 'next' | 'append' | 'replace'): void {
  const items = playlistQueueItems(library, playlist).filter((item): item is PlayerQueueItem => item !== null)
  if (items.length === 0) return
  if (position === 'replace') {
    player.playItems(items, { contextLabel: playlist.name, startIndex: 0, shuffle: false })
    return
  }
  if (!player.currentItem) {
    player.playItem(items[0]!, { contextLabel: playlist.name })
    if (items.length > 1) player.queue.addToQueue(items.slice(1))
    return
  }
  if (position === 'next') player.queue.playNext(items)
  else player.queue.addToQueue(items)
}

function playlistQueueItems(library: NormalizedLibrary, playlist: PlaylistDto): Array<PlayerQueueItem | null> {
  const items = playlist.items.length > 0
    ? playlist.items
    : playlist.entries.map((itemId, index) => ({ entryId: index + 1, itemType: 'THEME' as const, itemId, modeOverride: null }))
  const songs = new Map<number, { song: MusicTrackDto; artworkUrl: string | null; animeId: string }>()
  for (const [animeId, catalog] of Object.entries(library.musicCatalogByAnimeId)) {
    for (const release of catalog.releases) for (const song of release.tracks) songs.set(song.id, { song, artworkUrl: release.artworkUrl, animeId })
  }
  return items.map((item): PlayerQueueItem | null => {
    if (item.itemType === 'SONG') {
      const found = songs.get(item.itemId)
      return found ? mapSongToQueueItem(found.song, { artworkUrl: resolveBrowserAsset(found.artworkUrl), animeId: found.animeId }) : null
    }
    const theme = library.themesById[String(item.itemId)]
    if (!theme || theme.deleted) return null
    const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find((entry) => entry && !entry.deleted)
    const preferredMode = library.prefsByThemeId[String(theme.id)]?.preferredMode
    const mode = item.modeOverride ?? (playlist.overrideUserPreference ? playlist.defaultMode : preferredMode ?? playlist.defaultMode)
    return mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(anime?.posterUrl ?? anime?.coverUrl), animeId: anime?.kitsuId, mode })
  })
}

export function ServerErrorPage() {
  return <RouteSkeleton eyebrow="Service unavailable" title="We’re tuning the signal" description="This route is reserved for a server error surface with a safe retry action." icon={MonitorPlay} />
}
