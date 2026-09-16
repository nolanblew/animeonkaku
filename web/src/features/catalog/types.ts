import type { AnimeMusicDto, LibraryAnimeDto, LibraryThemeDto, MusicReleaseDto, MusicTrackDto, SongPrefDto, ThemePrefDto } from '../../lib/library'

export interface BrowserHomeAnimeSummary {
  kitsuId: string
  title: string | null
  posterUrl: string | null
  updatedAt: number
}

export interface BrowserHomePlaylistSummary {
  id: number
  name: string
  itemCount: number
  isAuto: boolean
  updatedAt: number
}

export interface BrowserHomeTopSongSummary {
  id: number
  title: string
  artistName?: string | null
  animeTitle?: string | null
  artworkUrl?: string | null
  relationshipType?: string | null
}

export interface BrowserHomeResponse {
  serverTime: number
  continueWatching: BrowserHomeAnimeSummary[]
  recentlyAdded: BrowserHomeAnimeSummary[]
  topSongs?: BrowserHomeTopSongSummary[]
  playlists: BrowserHomePlaylistSummary[]
  nextCursor: string | null
}

export interface BrowserTopPickAnimeSummary {
  kitsuId: string
  title: string | null
  titleEn: string | null
  posterUrl: string | null
}

export type BrowserTopPickReason = 'FAVORITE' | 'MOST_PLAYED' | 'DISCOVERY'

export interface BrowserTopPickTheme {
  key: string
  itemType: 'THEME'
  itemId: number
  reason: BrowserTopPickReason
  artworkUrl: string | null
  anime: BrowserTopPickAnimeSummary | null
  theme: LibraryThemeDto
  preference: ThemePrefDto | null
}

export interface BrowserTopPickSong {
  key: string
  itemType: 'SONG'
  itemId: number
  reason: BrowserTopPickReason
  artworkUrl: string | null
  anime: BrowserTopPickAnimeSummary | null
  track: MusicTrackDto
  release: Pick<MusicReleaseDto, 'id' | 'title' | 'relationshipType' | 'artworkUrl'>
  preference: SongPrefDto | null
}

export type BrowserTopPick = BrowserTopPickTheme | BrowserTopPickSong

export interface BrowserTopPicksResponse {
  serverTime: number
  snapshot: string
  generatedAt: number
  expiresAt: number
  total: number
  items: BrowserTopPick[]
}

export interface AnimeDetailResponse {
  anime: LibraryAnimeDto
  themes: LibraryThemeDto[]
}

export type CatalogAnime = Pick<LibraryAnimeDto, 'kitsuId' | 'title' | 'titleEn' | 'titleRomaji' | 'titleJa' | 'posterUrl' | 'watchingStatus' | 'subtype' | 'episodeCount' | 'genres'>

export interface CatalogMusicResponse extends AnimeMusicDto {}
