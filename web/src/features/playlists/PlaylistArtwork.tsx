import { Music2 } from 'lucide-react'
import { browserAssetUrl } from '../../lib/assets'
import type { NormalizedLibrary, PlaylistDto } from '../../lib/library'

export interface PlaylistArtworkProps {
  playlistId: number
  name: string
  artworkUrls: readonly string[]
  className?: string
}

export function PlaylistArtwork({ playlistId, name, artworkUrls, className = '' }: PlaylistArtworkProps) {
  const urls = artworkUrls.filter((value) => value.trim().length > 0).slice(0, 4)
  const layout = urls.length === 0 ? 'empty' : urls.length === 1 ? 'single' : urls.length === 2 ? 'double' : 'quad'
  return (
    <span className={`playlist-artwork playlist-artwork--${layout} ${className}`.trim()} data-layout={layout} data-testid={`playlist-artwork-${playlistId}`}>
      {urls.length === 0
        ? <span className="playlist-artwork__empty" aria-label={`${name} has no artwork yet`}><Music2 aria-hidden="true" /></span>
        : urls.map((url, index) => <img key={`${url}:${index}`} src={url} alt="" loading="lazy" decoding="async" />)}
    </span>
  )
}

export function playlistArtworkUrls(playlist: PlaylistDto | undefined, library: NormalizedLibrary | null | undefined): string[] {
  if (!playlist || !library) return []
  const urls: string[] = []
  for (const item of playlist.items.length > 0 ? playlist.items : playlist.entries.map((itemId) => ({ itemType: 'THEME' as const, itemId }))) {
    if (item.itemType === 'THEME') {
      const theme = library.themesById[String(item.itemId)]
      const anime = theme?.kitsuAnimeIds.map((id) => library.animeById[id]).find((candidate) => candidate && !candidate.deleted)
      const url = browserAssetUrl(anime?.posterUrl ?? anime?.coverUrl)
      if (url) urls.push(url)
      continue
    }
    for (const catalog of Object.values(library.musicCatalogByAnimeId)) {
      const release = catalog.releases.find((candidate) => candidate.tracks.some((track) => track.id === item.itemId))
      const url = browserAssetUrl(release?.artworkUrl ?? catalog.anime.posterUrl)
      if (url) { urls.push(url); break }
    }
  }
  return urls.slice(0, 4)
}
