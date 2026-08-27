import { browserAssetUrl } from '../../lib/assets'
import type { AnimeMusicDto, MusicReleaseDto, MusicTrackDto, NormalizedLibrary, PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'

export interface PlaylistDisplayItem {
  key: string
  title: string
  subtitle: string
  artworkUrl: string | null
  durationSeconds: number | null
  available: boolean
  itemType: 'THEME' | 'SONG'
  itemId: number
  modeOverride: PlaylistPlaybackMode | null
  liked: boolean
  disliked: boolean
  hasFullSize: boolean
  hasVideo: boolean
}

export interface PlaylistSongIndexEntry {
  song: MusicTrackDto
  anime: AnimeMusicDto['anime']
  release: MusicReleaseDto
  animeId: string
  releaseId: number
  artworkUrl: string | null
}

export type PlaylistSongIndex = ReadonlyMap<number, PlaylistSongIndexEntry>

/** Builds the song lookup once per normalized library snapshot. */
export function buildPlaylistSongIndex(library: NormalizedLibrary | null | undefined): Map<number, PlaylistSongIndexEntry> {
  const index = new Map<number, PlaylistSongIndexEntry>()
  for (const catalog of Object.values(library?.musicCatalogByAnimeId ?? {})) {
    for (const release of catalog.releases) {
      for (const song of release.tracks) {
        // A song ID is globally unique in the server catalog. Keeping the
        // first occurrence also preserves the old scan's deterministic order
        // if malformed data contains a duplicate.
        if (!index.has(song.id)) {
          index.set(song.id, {
            song,
            anime: catalog.anime,
            release,
            animeId: catalog.anime.kitsuId,
            releaseId: release.id,
            artworkUrl: release.artworkUrl ?? catalog.anime.posterUrl,
          })
        }
      }
    }
  }
  return index
}

export function resolvePlaylistDisplayItems(
  playlist: PlaylistDto,
  library: NormalizedLibrary | null | undefined,
  songIndex: PlaylistSongIndex = buildPlaylistSongIndex(library),
): PlaylistDisplayItem[] {
  const items = playlist.items.length > 0
    ? playlist.items
    : playlist.entries.map((itemId, index) => ({ entryId: index + 1, itemType: 'THEME' as const, itemId, modeOverride: null }))

  return items.map((item, index) => {
    const key = `${item.entryId ?? index}:${item.itemType}:${item.itemId}`
    if (item.itemType === 'THEME') {
      const theme = library?.themesById[String(item.itemId)]
      if (!theme || theme.deleted) return unavailableItem(key, item.itemType, item.itemId, item.modeOverride)
      const anime = theme.kitsuAnimeIds.map((id) => library?.animeById[id]).find((candidate) => candidate && !candidate.deleted)
      return {
        key,
        title: theme.title,
        subtitle: [anime?.titleEn ?? anime?.title, theme.themeType, theme.artists.map((artist) => artist.name).join(', ')].filter(Boolean).join(' · '),
        artworkUrl: browserAssetUrl(anime?.posterUrl ?? anime?.coverUrl) ?? null,
        durationSeconds: theme.durationSeconds,
        available: theme.audioState === 'READY',
        itemType: item.itemType,
        itemId: item.itemId,
        modeOverride: item.modeOverride,
        liked: library?.prefsByThemeId[String(item.itemId)]?.liked ?? false,
        disliked: library?.prefsByThemeId[String(item.itemId)]?.disliked ?? false,
        hasFullSize: Boolean(theme.mediaModes.fullSize),
        hasVideo: Boolean(theme.mediaModes.video),
      }
    }

    const found = songIndex.get(item.itemId)
    if (found) return {
      key,
      title: found.song.title,
      subtitle: [found.anime.titleEn ?? found.anime.title, found.song.artistCredit || found.release.artistCredit].filter(Boolean).join(' · '),
      artworkUrl: browserAssetUrl(found.artworkUrl) ?? null,
      durationSeconds: found.song.durationSeconds,
      available: Boolean(found.song.audioUrl),
      itemType: item.itemType,
      itemId: item.itemId,
      modeOverride: null,
      liked: library?.songPrefsById[String(item.itemId)]?.liked ?? false,
      disliked: library?.songPrefsById[String(item.itemId)]?.disliked ?? false,
      hasFullSize: true,
      hasVideo: false,
    }
    return unavailableItem(key, item.itemType, item.itemId, item.modeOverride)
  })
}

function unavailableItem(key: string, itemType: 'THEME' | 'SONG', itemId: number, modeOverride: PlaylistPlaybackMode | null): PlaylistDisplayItem {
  return { key, title: 'Unavailable track', subtitle: 'This item is no longer available in the catalog.', artworkUrl: null, durationSeconds: null, available: false, itemType, itemId, modeOverride, liked: false, disliked: false, hasFullSize: false, hasVideo: false }
}
