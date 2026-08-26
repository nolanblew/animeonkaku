import type { LibraryAnimeDto, LibraryThemeDto, NormalizedLibrary, PlaylistDto } from '../../lib/library'

export const SEARCH_DEBOUNCE_MS = 300
export const MAX_LIBRARY_RESULTS = { anime: 8, themes: 8, playlists: 6 } as const
export const MAX_LIBRARY_SCAN = 5_000
export const MAX_SERVER_RESULTS = 25

export interface LibraryMatches {
  anime: LibraryAnimeDto[]
  themes: LibraryThemeDto[]
  playlists: PlaylistDto[]
}

export interface MusicSearchTrack {
  anime?: { kitsuId?: string | null; title?: string | null; titleEn?: string | null; posterUrl?: string | null } | null
  relationshipType?: string | null
  releaseId?: number | null
  releaseTitle?: string | null
  track?: {
    id?: number | null
    title?: string | null
    artistCredit?: string | null
    durationSeconds?: number | null
    audioUrl?: string | null
  } | null
}

export interface MusicSearchRelease {
  anime?: Array<{ kitsuId?: string | null; title?: string | null; titleEn?: string | null; posterUrl?: string | null }> | null
  release?: {
    id?: number | null
    title?: string | null
    artistCredit?: string | null
    year?: number | null
    artworkUrl?: string | null
    tracks?: Array<{ id?: number | null; title?: string | null; artistCredit?: string | null }>
  } | null
}

export interface MusicSearchResponse {
  releases: MusicSearchRelease[]
  tracks: MusicSearchTrack[]
}

/** Keeps query matching predictable while retaining non-Latin titles. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim()
}

export function sanitizeSearchQuery(value: string | null | undefined): string {
  return normalizeSearchText(value ?? '').slice(0, 120)
}

export function findLibraryMatches(library: NormalizedLibrary | null, query: string): LibraryMatches {
  const normalizedQuery = sanitizeSearchQuery(query)
  if (!library || !normalizedQuery) return { anime: [], themes: [], playlists: [] }

  const anime = Object.values(library.animeById)
    .slice(0, MAX_LIBRARY_SCAN)
    .filter((item) => !item.deleted && includesQuery([
      item.title, item.titleEn, item.titleRomaji, item.titleJa, item.slug, ...item.genres,
    ], normalizedQuery))
    .slice(0, MAX_LIBRARY_RESULTS.anime)

  const themes = Object.values(library.themesById)
    .slice(0, MAX_LIBRARY_SCAN)
    .filter((item) => !item.deleted && includesQuery([
      item.title, item.themeType, ...item.artists.flatMap((artist) => [artist.name, artist.alias, artist.asCharacter]),
    ], normalizedQuery))
    .slice(0, MAX_LIBRARY_RESULTS.themes)

  const playlists = Object.values(library.playlistsById)
    .slice(0, MAX_LIBRARY_SCAN)
    .filter((item) => !item.deleted && includesQuery([item.name], normalizedQuery))
    .slice(0, MAX_LIBRARY_RESULTS.playlists)

  return { anime, themes, playlists }
}

export function parseMusicSearchResponse(value: unknown): MusicSearchResponse {
  const root = isRecord(value) && isRecord(value.music) ? value.music : value
  if (!isRecord(root)) return { releases: [], tracks: [] }
  return {
    releases: Array.isArray(root.releases) ? root.releases.filter(isRecord).slice(0, MAX_SERVER_RESULTS) as MusicSearchRelease[] : [],
    tracks: Array.isArray(root.tracks) ? root.tracks.filter(isRecord).slice(0, MAX_SERVER_RESULTS) as MusicSearchTrack[] : [],
  }
}

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  return values.some((value) => normalizeSearchText(value ?? '').includes(query))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
