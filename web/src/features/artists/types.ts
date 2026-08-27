import type { AudioState, LibraryThemeDto, MusicTrackDto } from '../../lib/library'

export interface ArtistAnimeLink {
  kitsuId: string
  title: string | null
  titleEn: string | null
  posterUrl: string | null
}

export interface ArtistThemeDto extends Omit<LibraryThemeDto, 'audioState'> {
  audioState?: AudioState
  anime?: ArtistAnimeLink[]
}

export interface ArtistFullSongDto extends Omit<MusicTrackDto, 'audioUrl'> {
  audioUrl?: string
  /** Raw artist responses expose song metadata before catalog media import. */
  audioAvailable?: boolean
  releaseId?: number | null
  releaseTitle?: string | null
  anime?: ArtistAnimeLink[]
}

export interface ArtistProfileDto {
  id: number
  name: string
  slug: string
  artworkUrl: string | null
  [key: string]: unknown
}

/**
 * The raw AnimeThemes artist payload is deliberately allowed to pass through
 * this response. Android reads artist.songs; the top-level projections are for
 * browser collection rendering and playback.
 */
export interface ArtistDetailResponse {
  artist: ArtistProfileDto & { songs?: unknown[] }
  themes: ArtistThemeDto[]
  fullSongs: ArtistFullSongDto[]
  [key: string]: unknown
}
