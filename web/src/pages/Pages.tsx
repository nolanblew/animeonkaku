import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ListMusic, MonitorPlay } from 'lucide-react'
import { RouteSkeleton } from '../components/RouteSkeleton'
import { AnimeDetailPage, HomeCatalogPage, LibraryCatalogPage } from '../features/catalog'
import { ArtistDetailPage, type ArtistDetailResponse } from '../features/artists'
import { RelatedMusicPage as RelatedMusicFeaturePage } from '../features/relatedmusic'
import { ReleaseDetailPage } from '../features/releases'
import { PlaylistDetail, PlaylistFeatureMessage, PlaylistManager, usePlaylist, usePlaylistMutations, usePlaylists } from '../features/playlists'
import { buildPlaylistSongIndex } from '../features/playlists/playlistDisplay'
import { SearchPage as AccountSearchPage, SettingsPage as AccountSettingsPage, type MusicSearchTrack } from '../features/accountsearch'
import { mapSongToQueueItem, mapThemeToQueueItem, NowPlayingView, runPlayerViewTransition, usePlayer, type PlayerContextValue, type PlayerQueueItem } from '../player'
import type { LibraryAnimeDto, LibraryThemeDto, MusicReleaseDto, MusicTrackDto, NormalizedLibrary, PlaylistDto } from '../lib/library'
import { browserAssetUrl } from '../lib/assets'
import { artistRouteSlug } from '../lib/navigation'
import { useLibraryQuery } from '../lib/query'
import { compareThemesByType } from '../lib/themePresentation'

export function HomePage() {
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <HomeCatalogPage
    onPlayTheme={(theme, artworkUrl) => player.playTheme(theme, themeQueueOptions(theme, library, artworkUrl))}
    onPlayAll={(themes, artworkUrl) => playThemeCollection(player, themes, 0, false, artworkUrl, library)}
    onPlayNext={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'next', artworkUrl, library)}
    onAddToQueue={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'append', artworkUrl, library)}
    onPlayPlaylist={library ? (playlist) => playPlaylist(player, library, playlist, false) : undefined}
    onPlayNextPlaylist={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'next') : undefined}
    onAddToQueuePlaylist={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'append') : undefined}
  />
}

export function LibraryPage() {
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <LibraryCatalogPage onPlayAnime={library ? (anime) => playAnimeCollection(player, library, anime) : undefined} onPlayTheme={(theme, artworkUrl) => player.playTheme(theme, themeQueueOptions(theme, library, artworkUrl))} onPlayNext={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'next', artworkUrl, library)} onAddToQueue={(theme, artworkUrl) => insertThemeCollection(player, [theme], 'append', artworkUrl, library)} onPlayPlaylist={library ? (playlist) => playPlaylist(player, library, playlist, false) : undefined} onPlayNextPlaylist={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'next') : undefined} onAddToQueuePlaylist={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'append') : undefined} />
}

export function SearchPage() {
  const player = usePlayer()
  const library = useLibraryQuery().library
  return <AccountSearchPage onPlayTheme={(theme) => {
    const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find(Boolean)
    player.playTheme(theme, { artworkUrl: browserAssetUrl(anime?.posterUrl), animeId: anime?.kitsuId, ...animeTitleQueueOptions(anime) })
  }} onPlayTrack={(result) => playSearchTrack(player.playSong, result)} onPlayNextTrack={(result) => enqueueSearchTrack(player, result, 'next')} onAddToQueueTrack={(result) => enqueueSearchTrack(player, result, 'append')} onReplaceQueueTrack={(result) => replaceSearchTrack(player, result)} />
}

export function AnimePage() {
  const player = usePlayer()
  const library = useLibraryQuery().library
  const playThemes = (themes: LibraryThemeDto[], startIndex = 0, shuffle = false, artworkUrl?: string | null) => playThemeCollection(player, themes, startIndex, shuffle, artworkUrl, library)
  return <AnimeDetailPage onPlayThemes={playThemes} onPlayNext={(themes, artworkUrl) => insertThemeCollection(player, themes, 'next', artworkUrl, library)} onAddToQueue={(themes, artworkUrl) => insertThemeCollection(player, themes, 'append', artworkUrl, library)} onPlaySong={(song, artworkUrl, animeId) => player.playSong(song, { artworkUrl: resolveBrowserAsset(artworkUrl), animeId })} onPlayNextSong={(song, release, animeId) => enqueueSong(player, song, release.title, resolveBrowserAsset(release.artworkUrl), animeId, 'next')} onAddToQueueSong={(song, release, animeId) => enqueueSong(player, song, release.title, resolveBrowserAsset(release.artworkUrl), animeId, 'append')} onReplaceQueueSong={(song, release, animeId) => replaceSong(player, song, release.title, resolveBrowserAsset(release.artworkUrl), animeId)} />
}

export function ArtistPage() {
  const player = usePlayer()
  return <ArtistDetailPage onPlayAll={(artist, shuffle) => playArtistCollection(player, artist, shuffle)} onPlayItem={(artist, startIndex) => playArtistCollection(player, artist, false, startIndex)} onPlayNextItem={(artist, index) => enqueueArtistItem(player, artist, index, 'next')} onAddToQueueItem={(artist, index) => enqueueArtistItem(player, artist, index, 'append')} onReplaceQueueItem={(artist, index) => replaceArtistItem(player, artist, index)} onPlayNextAll={(artist) => enqueueArtistCollection(player, artist, 'next')} onAddToQueueAll={(artist) => enqueueArtistCollection(player, artist, 'append')} onReplaceQueueAll={(artist) => replaceArtistCollection(player, artist)} />
}

export function RelatedMusicPage() {
  return <RelatedMusicFeaturePage />
}

export function ReleasePage() {
  const player = usePlayer()
  return <ReleaseDetailPage onPlayAll={(release, shuffle) => playReleaseCollection(player, release, shuffle)} onPlayTrack={(track, release, startIndex) => playReleaseTrack(player, track, release, startIndex)} onPlayNextTrack={(track, release) => enqueueSong(player, track, release.title, resolveBrowserAsset(release.artworkUrl), release.anime?.find((anime) => anime.kitsuId)?.kitsuId, 'next')} onAddToQueueTrack={(track, release) => enqueueSong(player, track, release.title, resolveBrowserAsset(release.artworkUrl), release.anime?.find((anime) => anime.kitsuId)?.kitsuId, 'append')} onReplaceQueueTrack={(track, release) => replaceSong(player, track, release.title, resolveBrowserAsset(release.artworkUrl), release.anime?.find((anime) => anime.kitsuId)?.kitsuId)} onPlayNextAll={(release) => enqueueReleaseCollection(player, release, 'next')} onAddToQueueAll={(release) => enqueueReleaseCollection(player, release, 'append')} onReplaceQueueAll={(release) => replaceReleaseCollection(player, release)} />
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
  return <PlaylistDetail playlist={query.playlist} library={library} onUpdate={mutations.update} onDelete={async (playlist) => { await mutations.remove(playlist); navigate('/playlists', { replace: true }) }} onBack={() => navigate('/playlists')} onPlay={library ? (playlist, shuffle) => playPlaylist(player, library, playlist, shuffle) : undefined} onPlayItem={library ? (playlist, index) => playPlaylist(player, library, playlist, false, index) : undefined} onPlayNextItem={library ? (playlist, index) => enqueuePlaylistItem(player, library, playlist, index, 'next') : undefined} onAddToQueueItem={library ? (playlist, index) => enqueuePlaylistItem(player, library, playlist, index, 'append') : undefined} onPlayNext={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'next') : undefined} onAddToQueue={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'append') : undefined} onReplaceQueue={library ? (playlist) => enqueuePlaylistCollection(player, library, playlist, 'replace') : undefined} onRefresh={(playlist) => mutations.refresh(playlist.id)} onNavigateToArtist={(artistName) => { const slug = artistRouteSlug(artistName); if (slug) navigate(`/artist/${encodeURIComponent(slug)}`) }} onNavigateToAnime={(animeId) => navigate(`/anime/${encodeURIComponent(animeId)}`)} />
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
  const song = searchTrackDto(result)
  if (!song) return
  playSong(song, { artworkUrl: resolveBrowserAsset(result.anime?.posterUrl), animeId: result.anime?.kitsuId })
}

function searchTrackDto(result: MusicSearchTrack): MusicTrackDto | null {
  const track = result.track
  if (!track || typeof track.id !== 'number' || !Number.isSafeInteger(track.id) || track.id <= 0 || !track.audioUrl || !track.title) return null
  return {
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
  }
}

function enqueueSearchTrack(player: PlayerContextValue, result: MusicSearchTrack, position: 'next' | 'append'): void {
  const song = searchTrackDto(result)
  if (!song) return
  const item = mapSongToQueueItem(song, { artworkUrl: resolveBrowserAsset(result.anime?.posterUrl), animeId: result.anime?.kitsuId })
  enqueueQueueItems(player, [item], position, result.releaseTitle || 'Search results')
}

function replaceSearchTrack(player: PlayerContextValue, result: MusicSearchTrack): void {
  const song = searchTrackDto(result)
  if (!song) return
  const item = mapSongToQueueItem(song, { artworkUrl: resolveBrowserAsset(result.anime?.posterUrl), animeId: result.anime?.kitsuId })
  replaceQueueItems(player, [item], result.releaseTitle || 'Search results')
}

function playReleaseCollection(player: PlayerContextValue, release: MusicReleaseDto, shuffle: boolean, startIndex = 0): void {
  const items = releaseQueueItems(release)
  if (items.length === 0) return
  player.playItems(items, { contextLabel: release.title, startIndex, shuffle })
}

function enqueueReleaseCollection(player: PlayerContextValue, release: MusicReleaseDto, position: 'next' | 'append'): void {
  enqueueQueueItems(player, releaseQueueItems(release), position, release.title)
}

function replaceReleaseCollection(player: PlayerContextValue, release: MusicReleaseDto): void {
  replaceQueueItems(player, releaseQueueItems(release), release.title)
}

function releaseQueueItems(release: MusicReleaseDto): PlayerQueueItem[] {
  const artworkUrl = resolveBrowserAsset(release.artworkUrl)
  const animeId = release.anime?.find((anime) => anime.kitsuId)?.kitsuId
  return release.tracks.map((track) => mapSongToQueueItem(track, { artworkUrl, animeId }))
}

function playReleaseTrack(player: PlayerContextValue, _track: MusicTrackDto, release: MusicReleaseDto, startIndex = 0): void {
  playReleaseCollection(player, release, false, startIndex)
}

function enqueueSong(player: PlayerContextValue, song: MusicTrackDto, contextLabel: string, artworkUrl?: string, animeId?: string, position: 'next' | 'append' = 'append'): void {
  const item = mapSongToQueueItem(song, { artworkUrl, animeId })
  enqueueQueueItems(player, [item], position, contextLabel)
}

function replaceSong(player: PlayerContextValue, song: MusicTrackDto, contextLabel: string, artworkUrl?: string, animeId?: string): void {
  const item = mapSongToQueueItem(song, { artworkUrl, animeId })
  replaceQueueItems(player, [item], contextLabel)
}

function enqueueQueueItems(player: PlayerContextValue, items: PlayerQueueItem[], position: 'next' | 'append', contextLabel: string): void {
  if (items.length === 0) return
  if (!player.currentItem) {
    player.playItem(items[0]!, { contextLabel })
    if (items.length > 1) player.queue.addToQueue(items.slice(1))
    return
  }
  if (position === 'next') player.queue.playNext(items)
  else player.queue.addToQueue(items)
}

function replaceQueueItems(player: PlayerContextValue, items: PlayerQueueItem[], contextLabel: string): void {
  if (items.length === 0) return
  player.playItems(items, { contextLabel, startIndex: 0, shuffle: false })
}

function playArtistCollection(player: PlayerContextValue, artist: ArtistDetailResponse, shuffle: boolean, startIndex = 0): void {
  const items = artistQueueItems(artist).filter((item): item is PlayerQueueItem => item !== null)
  if (items.length === 0) return
  const boundedStartIndex = Math.max(0, Math.min(startIndex, Math.max(0, items.length - 1)))
  player.playItems(items, { contextLabel: artist.artist.name || 'Artist', startIndex: boundedStartIndex, shuffle })
}

function enqueueArtistItem(player: PlayerContextValue, artist: ArtistDetailResponse, index: number, position: 'next' | 'append'): void {
  const item = artistQueueItems(artist)[index]
  if (item) enqueueQueueItems(player, [item], position, artist.artist.name || 'Artist')
}

function enqueueArtistCollection(player: PlayerContextValue, artist: ArtistDetailResponse, position: 'next' | 'append'): void {
  const items = artistQueueItems(artist).filter((item): item is PlayerQueueItem => item !== null)
  enqueueQueueItems(player, items, position, artist.artist.name)
}

function replaceArtistCollection(player: PlayerContextValue, artist: ArtistDetailResponse): void {
  const items = artistQueueItems(artist).filter((item): item is PlayerQueueItem => item !== null)
  replaceQueueItems(player, items, artist.artist.name)
}

function replaceArtistItem(player: PlayerContextValue, artist: ArtistDetailResponse, index: number): void {
  const item = artistQueueItems(artist)[index]
  if (item) replaceQueueItems(player, [item], artist.artist.name || 'Artist')
}

function artistQueueItems(artist: ArtistDetailResponse): Array<PlayerQueueItem | null> {
  const artworkUrl = resolveBrowserAsset(artist.artist.artworkUrl)
  const themes = Array.isArray(artist.themes) ? artist.themes : []
  const songs = Array.isArray(artist.fullSongs) ? artist.fullSongs : []
  return [
    ...themes.map((theme) => {
      const anime = theme.anime?.find((entry) => entry.kitsuId)
      return theme.audioUrl && theme.audioState !== 'FAILED' && theme.audioState !== 'MISSING' ? mapThemeToQueueItem(theme as LibraryThemeDto, { artworkUrl: resolveBrowserAsset(anime?.posterUrl) ?? artworkUrl, animeId: anime?.kitsuId, ...animeTitleQueueOptions(anime) }) : null
    }),
    ...songs.map((song) => song.audioAvailable !== false && song.audioUrl ? mapSongToQueueItem(song as MusicTrackDto, { artworkUrl }) : null),
  ]
}

function playThemeCollection(player: PlayerContextValue, themes: LibraryThemeDto[], startIndex: number, shuffle: boolean, artworkUrl?: string | null, library?: NormalizedLibrary | null): void {
  const items = themes.map((theme) => mapThemeToQueueItem(theme, themeQueueOptions(theme, library, artworkUrl)))
  if (items.length === 0) return
  player.playItems(items, { contextLabel: themes.length === 1 ? themes[0]?.title : 'Anime themes', startIndex, shuffle })
}

function playAnimeCollection(player: PlayerContextValue, library: NormalizedLibrary, anime: LibraryAnimeDto): void {
  const themes = Object.values(library.themesById)
    .filter((theme) => !theme.deleted && theme.kitsuAnimeIds.includes(anime.kitsuId) && isPlayableTheme(theme))
    .sort(compareThemesByType)
  playThemeCollection(player, themes, 0, false, anime.posterUrl ?? anime.coverUrl, library)
}

function isPlayableTheme(theme: LibraryThemeDto): boolean {
  return Boolean(theme.mediaModes.tvSize?.url || theme.mediaModes.fullSize?.url || theme.mediaModes.video?.url || theme.audioUrl)
}

function insertThemeCollection(player: PlayerContextValue, themes: LibraryThemeDto[], position: 'next' | 'append', artworkUrl?: string | null, library?: NormalizedLibrary | null): void {
  const items = themes.map((theme) => mapThemeToQueueItem(theme, themeQueueOptions(theme, library, artworkUrl)))
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

function themeQueueOptions(theme: LibraryThemeDto, library?: NormalizedLibrary | null, artworkUrl?: string | null) {
  const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find((entry) => entry && !entry.deleted)
  return { artworkUrl: resolveBrowserAsset(artworkUrl ?? anime?.posterUrl ?? anime?.coverUrl), animeId: anime?.kitsuId ?? theme.kitsuAnimeIds[0], ...animeTitleQueueOptions(anime) }
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
  const songs = buildPlaylistSongIndex(library)
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
    return mapThemeToQueueItem(theme, { artworkUrl: resolveBrowserAsset(anime?.posterUrl ?? anime?.coverUrl), animeId: anime?.kitsuId, ...animeTitleQueueOptions(anime), mode })
  })
}

export function ServerErrorPage() {
  return <RouteSkeleton eyebrow="Service unavailable" title="We’re tuning the signal" description="This route is reserved for a server error surface with a safe retry action." icon={MonitorPlay} />
}

function animeTitleQueueOptions(anime: Partial<Pick<LibraryAnimeDto, 'title' | 'titleEn' | 'titleRomaji' | 'titleJa'>> | null | undefined) {
  if (!anime) return {}
  return {
    animeTitle: anime.title ?? anime.titleEn,
    ...(anime.titleEn ? { animeTitleEn: anime.titleEn } : {}),
    ...(anime.titleRomaji ? { animeTitleRomaji: anime.titleRomaji } : {}),
    ...(anime.titleJa ? { animeTitleJa: anime.titleJa } : {}),
  }
}
