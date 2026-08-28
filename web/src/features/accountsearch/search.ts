import type { LibraryAnimeDto, LibraryThemeDto, NormalizedLibrary, PlaylistDto } from '../../lib/library'

export const SEARCH_DEBOUNCE_MS = 300
export const MAX_LIBRARY_RESULTS = { anime: 8, themes: 8, artists: 8, playlists: 6 } as const
export const MAX_LIBRARY_SCAN = 5_000
export const MAX_SERVER_RESULTS = 25

export interface LibraryMatches {
  anime: LibraryAnimeDto[]
  themes: LibraryThemeDto[]
  artists: Array<{ name: string; themeCount: number }>
  playlists: PlaylistDto[]
}

export interface AnimeThemesSearchAnime {
  animeThemesId: number
  kitsuId: string | null
  name: string
  imageUrl: string | null
  themeCount: number
}

export interface AnimeThemesSearchTheme {
  id: number
  animeThemesAnimeId: number
  kitsuId: string | null
  animeName: string
  imageUrl: string | null
  title: string
  themeType: string | null
  artist: string | null
}

export interface AnimeThemesSearchArtist {
  id: number | string
  name: string
  slug: string
  imageUrl: string | null
}

export interface SearchResponse {
  animeThemes: {
    anime: AnimeThemesSearchAnime[]
    themes: AnimeThemesSearchTheme[]
    artists: AnimeThemesSearchArtist[]
  }
  music: MusicSearchResponse
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
  if (!library || !normalizedQuery) return { anime: [], themes: [], artists: [], playlists: [] }

  const anime = Object.values(library.animeById)
    .slice(0, MAX_LIBRARY_SCAN)
    .filter((item) => !item.deleted && includesQuery([
      item.title, item.titleEn, item.titleRomaji, item.titleJa, item.slug, ...(Array.isArray(item.genres) ? item.genres : []),
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

  const artistCounts = new Map<string, { name: string; themeCount: number }>()
  for (const theme of Object.values(library.themesById).slice(0, MAX_LIBRARY_SCAN)) {
    if (theme.deleted) continue
    for (const artist of theme.artists) {
      const name = artist.name?.trim()
      if (!name || !includesQuery([name, artist.alias, artist.asCharacter], normalizedQuery)) continue
      const key = normalizeSearchText(name)
      const existing = artistCounts.get(key)
      artistCounts.set(key, { name: existing?.name ?? name, themeCount: (existing?.themeCount ?? 0) + 1 })
    }
  }
  const artists = [...artistCounts.values()]
    .sort((left, right) => right.themeCount - left.themeCount || left.name.localeCompare(right.name))
    .slice(0, MAX_LIBRARY_RESULTS.artists)

  return { anime, themes, artists, playlists }
}

export function parseSearchResponse(value: unknown): SearchResponse {
  const root = isRecord(value) ? value : {}
  const search = recordValue(recordValue(root.animeThemes)?.search)
  const rawAnime = recordArray(search?.anime).slice(0, MAX_SERVER_RESULTS)
  const anime: AnimeThemesSearchAnime[] = []
  const themes: AnimeThemesSearchTheme[] = []

  for (const candidate of rawAnime) {
    const animeThemesId = positiveNumber(candidate.id)
    const name = stringValue(candidate.name)
    if (!animeThemesId || !name) continue
    const kitsuId = kitsuResourceId(candidate.resources)
    const imageUrl = bestImageUrl(candidate.images)
    const rawThemes = recordArray(candidate.animethemes)
    anime.push({ animeThemesId, kitsuId, name, imageUrl, themeCount: rawThemes.length })
    for (const rawTheme of rawThemes) {
      if (themes.length >= MAX_SERVER_RESULTS) break
      const id = positiveNumber(rawTheme.id)
      const song = recordValue(rawTheme.song)
      const title = stringValue(song?.title)
      if (!id || !title) continue
      const baseType = stringValue(rawTheme.type)
      const sequence = positiveNumber(rawTheme.sequence)
      const artistNames = recordArray(song?.artists).map((artist) => stringValue(artist.name)).filter((artist): artist is string => Boolean(artist))
      themes.push({
        id,
        animeThemesAnimeId: animeThemesId,
        kitsuId,
        animeName: name,
        imageUrl,
        title,
        themeType: baseType ? `${baseType}${sequence && sequence > 1 ? sequence : ''}` : null,
        artist: artistNames.join(', ') || null,
      })
    }
  }

  const artists = recordArray(search?.artists).slice(0, MAX_SERVER_RESULTS).flatMap((candidate) => {
    const id = positiveNumber(candidate.id) ?? stringValue(candidate.id)
    const name = stringValue(candidate.name)
    const slug = stringValue(candidate.slug)
    return id && name && slug ? [{ id, name, slug, imageUrl: bestImageUrl(candidate.images) }] : []
  })

  return { animeThemes: { anime, themes, artists }, music: parseMusicSearchResponse(root) }
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) && !Array.isArray(value) ? value : null
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(recordValue(item))) : []
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function kitsuResourceId(value: unknown): string | null {
  const resource = recordArray(value).find((item) => stringValue(item.site)?.toLowerCase() === 'kitsu')
  return stringValue(resource?.external_id ?? resource?.externalId)
}

function bestImageUrl(value: unknown): string | null {
  const images = recordArray(value)
  const preferred = images.find((image) => stringValue(image.facet)?.toLowerCase().includes('large')) ?? images[0]
  const link = stringValue(preferred?.link)
  if (link) return link
  const path = stringValue(preferred?.path)
  if (!path) return null
  return /^https?:\/\//i.test(path) ? path : `https://i.animethemes.moe/${path.replace(/^\/+/, '')}`
}
