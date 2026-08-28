import type { AnimeMusicDto, LibraryAnimeDto, LibraryThemeDto } from '../../lib/library'

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

export interface AnimeDetailResponse {
  anime: LibraryAnimeDto
  themes: LibraryThemeDto[]
}

export type CatalogAnime = Pick<LibraryAnimeDto, 'kitsuId' | 'title' | 'titleEn' | 'titleRomaji' | 'titleJa' | 'posterUrl' | 'watchingStatus' | 'subtype' | 'episodeCount' | 'genres'>

export interface CatalogMusicResponse extends AnimeMusicDto {}
