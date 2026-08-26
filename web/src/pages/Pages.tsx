import { useNavigate, useParams } from 'react-router-dom'
import { ListMusic, MonitorPlay } from 'lucide-react'
import { RouteSkeleton } from '../components/RouteSkeleton'
import { AnimeDetailPage, HomeCatalogPage, LibraryCatalogPage } from '../features/catalog'
import { PlaylistDetail, PlaylistFeatureMessage, PlaylistManager, usePlaylist, usePlaylistMutations, usePlaylists } from '../features/playlists'
import { SearchPage as AccountSearchPage, SettingsPage as AccountSettingsPage, type MusicSearchTrack } from '../features/accountsearch'
import { mapSongToQueueItem, mapThemeToQueueItem, NowPlayingView, usePlayer, type PlayerContextValue, type PlayerQueueItem } from '../player'
import type { LibraryThemeDto, MusicTrackDto, NormalizedLibrary, PlaylistDto } from '../lib/library'
import { browserAssetUrl } from '../lib/assets'
import { useLibraryQuery } from '../lib/query'

export function HomePage() {
  return <HomeCatalogPage />
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
  const playThemes = (themes: LibraryThemeDto[], _startIndex = 0, shuffle = false, artworkUrl?: string | null) => playThemeCollection(player, themes, shuffle, artworkUrl)
  return <AnimeDetailPage onPlayThemes={playThemes} onPlayNext={(themes, artworkUrl) => insertThemeCollection(player, themes, 'next', artworkUrl)} onAddToQueue={(themes, artworkUrl) => insertThemeCollection(player, themes, 'append', artworkUrl)} onPlaySong={(song, artworkUrl, animeId) => player.playSong(song, { artworkUrl: resolveBrowserAsset(artworkUrl), animeId })} />
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
  return <PlaylistDetail playlist={query.playlist} onUpdate={mutations.update} onDelete={async (playlist) => { await mutations.remove(playlist); navigate('/playlists', { replace: true }) }} onBack={() => navigate('/playlists')} onPlay={library ? (playlist, shuffle) => playPlaylist(player, library, playlist, shuffle) : undefined} />
}

export function PlaylistsPage() {
  const query = usePlaylists()
  const mutations = usePlaylistMutations()
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <section className="page" aria-labelledby="playlists-page-title"><h1 id="playlists-page-title" className="sr-only">Playlists</h1><PlaylistManager playlists={query.playlists} state={query.isPending ? 'loading' : query.isError ? 'error' : query.playlists.length === 0 ? 'empty' : 'ready'} error={query.isError ? 'Could not load playlists.' : undefined} onCreate={mutations.create} onUpdate={mutations.update} onDelete={mutations.remove} onPlay={library ? (playlist, shuffle) => playPlaylist(player, library, playlist, shuffle) : undefined} /></section>
}

export function NowPlayingPage() {
  return <section className="now-playing-page" aria-labelledby="now-playing-title"><h1 id="now-playing-title" className="sr-only">Now playing</h1><NowPlayingView /></section>
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

function playThemeCollection(player: PlayerContextValue, themes: LibraryThemeDto[], shuffle: boolean, artworkUrl?: string | null): void {
  const items = themes.map((theme) => mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(artworkUrl) }))
  if (items.length === 0) return
  player.playItem(items[0]!, { contextLabel: themes.length === 1 ? themes[0]?.title : 'Anime themes' })
  if (items.length > 1) player.queue.addToQueue(items.slice(1))
  if (shuffle && items.length > 1) player.setShuffle(true)
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

function playPlaylist(player: PlayerContextValue, library: NormalizedLibrary, playlist: PlaylistDto, shuffle: boolean): void {
  const items = playlist.items.length > 0
    ? playlist.items
    : playlist.entries.map((itemId, index) => ({ entryId: index + 1, itemType: 'THEME' as const, itemId, modeOverride: null }))
  const songs = new Map<number, { song: MusicTrackDto; artworkUrl: string | null; animeId: string }>()
  for (const [animeId, catalog] of Object.entries(library.musicCatalogByAnimeId)) {
    for (const release of catalog.releases) for (const song of release.tracks) songs.set(song.id, { song, artworkUrl: release.artworkUrl, animeId })
  }
  const queueItems = items.flatMap((item): PlayerQueueItem[] => {
    if (item.itemType === 'SONG') {
      const found = songs.get(item.itemId)
      return found ? [mapSongToQueueItem(found.song, { artworkUrl: resolveBrowserAsset(found.artworkUrl), animeId: found.animeId })] : []
    }
    const theme = library.themesById[String(item.itemId)]
    if (!theme || theme.deleted) return []
    const anime = theme.kitsuAnimeIds.map((id) => library.animeById[id]).find((entry) => entry && !entry.deleted)
    const preferredMode = library.prefsByThemeId[String(theme.id)]?.preferredMode
    const mode = item.modeOverride ?? (playlist.overrideUserPreference ? playlist.defaultMode : preferredMode ?? playlist.defaultMode)
    return [mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(anime?.posterUrl ?? anime?.coverUrl), animeId: anime?.kitsuId, mode })]
  })
  if (queueItems.length === 0) return
  player.playItem(queueItems[0]!, { contextLabel: playlist.name })
  if (queueItems.length > 1) player.queue.addToQueue(queueItems.slice(1))
  if (shuffle && queueItems.length > 1) player.setShuffle(true)
}

export function ServerErrorPage() {
  return <RouteSkeleton eyebrow="Service unavailable" title="We’re tuning the signal" description="This route is reserved for a server error surface with a safe retry action." icon={MonitorPlay} />
}
