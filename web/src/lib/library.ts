export type AudioState = 'READY' | 'PENDING' | 'FAILED' | 'MISSING'
export type LoudnessDto =
  | { integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number; gainDb: number; policyVersion: number; state: 'READY' }
  | { state: 'PENDING' | 'FAILED' }

export interface MusicTrackDto {
  id: number
  title: string
  titleEnglish: string | null
  titleRomaji: string | null
  titleJapanese: string | null
  artistCredit: string
  artistNames: Array<{ english?: string | null; romaji?: string | null; japanese?: string | null }>
  durationSeconds: number | null
  audioUrl: string
  fileSize: number | null
  discNumber: number
  trackNumber: number | null
  displayOrder: number
  loudness?: LoudnessDto
}

export interface MusicReleaseDto {
  id: number
  title: string
  titleEnglish: string | null
  titleRomaji: string | null
  titleJapanese: string | null
  artistCredit: string
  artistNames: Array<{ english?: string | null; romaji?: string | null; japanese?: string | null }>
  relationshipType: string
  releaseDate: string | null
  year: number | null
  artworkUrl: string | null
  tracks: MusicTrackDto[]
  anime?: Array<MusicAnimeSummaryDto & { relationshipType: string }>
}

export interface MusicAnimeSummaryDto {
  kitsuId: string
  title: string | null
  titleEn: string | null
  posterUrl: string | null
}

export interface AnimeMusicDto {
  anime: MusicAnimeSummaryDto
  releases: MusicReleaseDto[]
}

export interface ThemeMediaModesDto {
  tvSize: { url: string; durationSeconds: number | null; fileSize: number | null; loudness?: LoudnessDto }
  fullSize: { songId: number; url: string; durationSeconds: number | null; fileSize: number | null; sourceReleaseId: number | null; loudness?: LoudnessDto } | null
  video: { url: string; mimeType: string | null; spoiler: boolean; nsfw: boolean; entryVersion: number | null } | null
}

export interface LibraryAnimeDto {
  kitsuId: string
  animeThemesId: number | null
  title: string | null
  titleEn: string | null
  titleRomaji: string | null
  titleJa: string | null
  posterUrl: string | null
  coverUrl: string | null
  watchingStatus: string | null
  subtype: string | null
  startDate: string | null
  endDate: string | null
  episodeCount: number | null
  ageRating: string | null
  averageRating: number | null
  userRating: number | null
  libraryUpdatedAt: number | null
  slug: string | null
  genres: string[]
  updatedAt: number
  deleted: boolean
}

export interface LibraryThemeDto {
  id: number
  animeThemesAnimeId: number
  kitsuAnimeIds: string[]
  title: string
  themeType: string | null
  artists: Array<{ name: string; asCharacter: string | null; alias: string | null }>
  audioUrl: string
  videoUrl: string | null
  audioState: AudioState
  durationSeconds: number | null
  fileSize: number | null
  mediaModes: ThemeMediaModesDto
  updatedAt: number
  deleted: boolean
}

export type PlaylistPlaybackMode = 'TV_SIZE' | 'FULL_SIZE'
export interface PlaylistItemDto {
  entryId: number
  itemType: 'THEME' | 'SONG'
  itemId: number
  modeOverride: PlaylistPlaybackMode | null
}

export interface ThemePrefDto {
  themeId: number
  liked: boolean
  disliked: boolean
  dislikedTvSize: boolean
  dislikedFullSize: boolean
  preferredMode: PlaylistPlaybackMode | null
  playCount: number
  lastPlayedAt: number | null
  updatedAt: number
  deleted: boolean
}

export interface SongPrefDto {
  songId: number
  liked: boolean
  disliked: boolean
  playCount: number
  lastPlayedAt: number | null
  updatedAt: number
  deleted: boolean
}

export interface PlaylistDto {
  id: number
  name: string
  entries: number[]
  defaultMode: PlaylistPlaybackMode
  overrideUserPreference: boolean
  items: PlaylistItemDto[]
  isAuto: boolean
  isDynamic: boolean
  autoUpdate: boolean
  updatedAt: number
  deleted: boolean
  dynamicSpecJson: unknown | null
  dynamicSortJson: unknown | null
}

export interface ChangesResponse {
  serverTime: number
  anime: LibraryAnimeDto[]
  themes: LibraryThemeDto[]
  prefs: ThemePrefDto[]
  songPrefs: SongPrefDto[]
  playlists: PlaylistDto[]
  musicCatalog?: AnimeMusicDto[]
}

export type EntityMap<T> = Record<string, T>

export interface NormalizedLibrary {
  cursor: number
  animeById: EntityMap<LibraryAnimeDto>
  themesById: EntityMap<LibraryThemeDto>
  prefsByThemeId: EntityMap<ThemePrefDto>
  songPrefsById: EntityMap<SongPrefDto>
  playlistsById: EntityMap<PlaylistDto>
  musicCatalogByAnimeId: EntityMap<AnimeMusicDto>
}

export function createEmptyLibrary(): NormalizedLibrary {
  return {
    cursor: 0,
    animeById: {},
    themesById: {},
    prefsByThemeId: {},
    songPrefsById: {},
    playlistsById: {},
    musicCatalogByAnimeId: {},
  }
}

/** Applies a full snapshot or a server cursor delta without mutating prior query data. */
export function applyChanges(previous: NormalizedLibrary, response: ChangesResponse): NormalizedLibrary {
  return {
    cursor: Math.max(previous.cursor, response.serverTime),
    animeById: upsert(previous.animeById, response.anime, (item) => item.kitsuId),
    themesById: upsert(previous.themesById, response.themes, (item) => String(item.id)),
    prefsByThemeId: upsert(previous.prefsByThemeId, response.prefs, (item) => String(item.themeId)),
    songPrefsById: upsert(previous.songPrefsById, response.songPrefs, (item) => String(item.songId)),
    playlistsById: upsert(previous.playlistsById, response.playlists, (item) => String(item.id)),
    musicCatalogByAnimeId: response.musicCatalog === undefined
      ? previous.musicCatalogByAnimeId
      : upsert({}, response.musicCatalog, (item) => item.anime.kitsuId),
  }
}

/** Descriptive alias for callers that treat the feed as a normalization step. */
export const normalizeLibraryChanges = applyChanges

export function selectActiveAnime(library: NormalizedLibrary): LibraryAnimeDto[] {
  return Object.values(library.animeById).filter((item) => !item.deleted)
}

export function selectActiveThemes(library: NormalizedLibrary): LibraryThemeDto[] {
  return Object.values(library.themesById).filter((item) => !item.deleted)
}

export function selectActivePlaylists(library: NormalizedLibrary): PlaylistDto[] {
  return Object.values(library.playlistsById).filter((item) => !item.deleted)
}

function upsert<T>(previous: EntityMap<T>, items: T[], key: (item: T) => string): EntityMap<T> {
  if (items.length === 0) return previous
  const next = { ...previous }
  for (const item of items) next[key(item)] = item
  return next
}
