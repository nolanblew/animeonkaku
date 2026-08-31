import { Music2 } from 'lucide-react'
import { MediaArtwork } from '../../components/MediaPresentation'
import { browserAssetUrl } from '../../lib/assets'
import type { NormalizedLibrary, PlaylistDto } from '../../lib/library'

export interface PlaylistArtworkProps {
  playlistId: number
  name: string
  artworkUrls: readonly string[]
  className?: string
}

export function PlaylistArtwork({ playlistId, name, artworkUrls, className = '' }: PlaylistArtworkProps) {
  const urls = uniqueArtworkUrls(artworkUrls).slice(0, 4)
  const layout = urls.length === 0 ? 'empty' : urls.length === 1 ? 'single' : urls.length === 2 ? 'double' : 'quad'
  return <MediaArtwork
    imageUrls={urls}
    label={`${name} has no artwork yet`}
    fallback={<Music2 aria-hidden="true" />}
    className={`playlist-artwork playlist-artwork--${layout} ${className}`.trim()}
    testId={`playlist-artwork-${playlistId}`}
  />
}

export function playlistArtworkUrls(playlist: PlaylistDto | undefined, library: NormalizedLibrary | null | undefined): string[] {
  if (!playlist || !library) return []
  const urls: string[] = []
  const seenAnimeIds = new Set<string>()
  const seenArtworkUrls = new Set<string>()
  const addArtwork = (animeId: string | undefined, value: string | null | undefined) => {
    const url = browserAssetUrl(value)
    if (!url || (animeId && seenAnimeIds.has(animeId)) || seenArtworkUrls.has(url)) return
    if (animeId) seenAnimeIds.add(animeId)
    seenArtworkUrls.add(url)
    urls.push(url)
  }
  for (const item of playlist.items.length > 0 ? playlist.items : playlist.entries.map((itemId) => ({ itemType: 'THEME' as const, itemId }))) {
    if (item.itemType === 'THEME') {
      const theme = library.themesById[String(item.itemId)]
      const anime = theme?.kitsuAnimeIds.map((id) => library.animeById[id]).find((candidate) => candidate && !candidate.deleted)
      addArtwork(anime?.kitsuId, anime?.posterUrl ?? anime?.coverUrl)
      continue
    }
    for (const catalog of Object.values(library.musicCatalogByAnimeId)) {
      const release = catalog.releases.find((candidate) => candidate.tracks.some((track) => track.id === item.itemId))
      const animeId = catalog.anime.kitsuId
      const url = release?.artworkUrl ?? catalog.anime.posterUrl
      if (url) { addArtwork(animeId, url); break }
    }
  }
  return urls.slice(0, 4)
}

function uniqueArtworkUrls(values: readonly string[]): string[] {
  const seen = new Set<string>()
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !seen.has(value) && seen.add(value))
}
