import { browserAssetUrl } from '../../lib/assets'
import type { NormalizedLibrary, PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'

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

export function resolvePlaylistDisplayItems(playlist: PlaylistDto, library: NormalizedLibrary | null | undefined): PlaylistDisplayItem[] {
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

    for (const catalog of Object.values(library?.musicCatalogByAnimeId ?? {})) {
      for (const release of catalog.releases) {
        const song = release.tracks.find((track) => track.id === item.itemId)
        if (!song) continue
        return {
          key,
          title: song.title,
          subtitle: [catalog.anime.titleEn ?? catalog.anime.title, song.artistCredit || release.artistCredit].filter(Boolean).join(' · '),
          artworkUrl: browserAssetUrl(release.artworkUrl ?? catalog.anime.posterUrl) ?? null,
          durationSeconds: song.durationSeconds,
          available: Boolean(song.audioUrl),
          itemType: item.itemType,
          itemId: item.itemId,
          modeOverride: null,
          liked: library?.songPrefsById[String(item.itemId)]?.liked ?? false,
          disliked: library?.songPrefsById[String(item.itemId)]?.disliked ?? false,
          hasFullSize: true,
          hasVideo: false,
        }
      }
    }
    return unavailableItem(key, item.itemType, item.itemId, item.modeOverride)
  })
}

function unavailableItem(key: string, itemType: 'THEME' | 'SONG', itemId: number, modeOverride: PlaylistPlaybackMode | null): PlaylistDisplayItem {
  return { key, title: 'Unavailable track', subtitle: 'This item is no longer available in the catalog.', artworkUrl: null, durationSeconds: null, available: false, itemType, itemId, modeOverride, liked: false, disliked: false, hasFullSize: false, hasVideo: false }
}
