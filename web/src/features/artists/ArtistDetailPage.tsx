import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Disc3, Play, Shuffle } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { browserAssetUrl } from '../../lib/assets'
import { CatalogError, CatalogLoading } from '../catalog/CatalogError'
import { CollectionActionMenu, TrackActionMenu, type PlaylistItemInput } from '../libraryactions'
import { formatThemeType, themePresentation } from '../../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../../lib/animeTitlePreference'
import type { ArtistAnimeLink, ArtistDetailResponse, ArtistFullSongDto, ArtistThemeDto } from './types'
import './artists.css'

export interface ArtistDetailPageProps {
  onPlayAll?: (artist: ArtistDetailResponse, shuffle: boolean) => void
  onPlayItem?: (artist: ArtistDetailResponse, startIndex: number) => void
  onPlayNextItem?: (artist: ArtistDetailResponse, startIndex: number) => void
  onAddToQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void
  onReplaceQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void
  onPlayNextAll?: (artist: ArtistDetailResponse) => void
  onAddToQueueAll?: (artist: ArtistDetailResponse) => void
  onReplaceQueueAll?: (artist: ArtistDetailResponse) => void
}

export function ArtistDetailPage({ onPlayAll, onPlayItem, onPlayNextItem, onAddToQueueItem, onReplaceQueueItem, onPlayNextAll, onAddToQueueAll, onReplaceQueueAll }: ArtistDetailPageProps = {}) {
  const { artistSlug } = useParams()
  const query = useQuery<ArtistDetailResponse>({
    queryKey: ['artist', artistSlug],
    enabled: Boolean(artistSlug),
    queryFn: ({ signal }) => apiClient.get<ArtistDetailResponse>(`/v1/artists/${encodeURIComponent(artistSlug!)}`, { signal }),
    staleTime: 60_000,
  })

  if (!artistSlug) return <CatalogError title="Artist unavailable" message="This artist link is not valid." />
  if (query.isError) return <CatalogError title="Artist unavailable" message="Could not load this artist. Try again in a moment." error={query.error} onRetry={() => void query.refetch()} />
  if (query.isPending || !query.data) return <CatalogLoading label="Loading artist details" />

  const artist = query.data.artist
  const name = artist.name.trim() || 'Unknown artist'
  const themes = Array.isArray(query.data.themes) ? query.data.themes : []
  const fullSongs = Array.isArray(query.data.fullSongs) ? query.data.fullSongs : []
  const artworkUrl = browserAssetUrl(artist.artworkUrl)
  const totalSongs = themes.length + fullSongs.length
  const playableSongs = themes.filter((theme) => Boolean(theme.audioUrl) && theme.audioState !== 'FAILED' && theme.audioState !== 'MISSING').length + fullSongs.filter((song) => song.audioAvailable !== false && Boolean(song.audioUrl)).length
  const collectionItems = collectionPlaylistItems(themes, fullSongs)

  return (
    <section className="page artist-page" aria-labelledby="artist-title">
      <Link className="catalog-back-link" to="/search"><ArrowLeft size={16} /> Back to search</Link>
      <header className="artist-page__hero">
        <ArtistArtwork artworkUrl={artworkUrl} name={name} />
        <div className="artist-page__copy">
          <p className="eyebrow">Artist</p>
          <h1 id="artist-title">{name}</h1>
          <div className="artist-page__facts" aria-label="Artist metadata">
            <span>{totalSongs} {totalSongs === 1 ? 'song' : 'songs'}</span>
            <span>{animeCount(themes, fullSongs)} anime</span>
          </div>
          <div className="artist-page__actions">
            <button className="button button--primary" type="button" disabled={!onPlayAll || playableSongs === 0} onClick={() => onPlayAll?.(query.data, false)}><Play size={17} fill="currentColor" /> Play all</button>
            <button className="button button--secondary" type="button" disabled={!onPlayAll || playableSongs === 0} onClick={() => onPlayAll?.(query.data, true)}><Shuffle size={17} /> Shuffle</button>
            <CollectionActionMenu name={name} items={collectionItems} onPlayNext={onPlayNextAll ? () => onPlayNextAll(query.data) : undefined} onAddToQueue={onAddToQueueAll ? () => onAddToQueueAll(query.data) : undefined} onReplaceQueue={onReplaceQueueAll ? () => onReplaceQueueAll(query.data) : undefined} />
          </div>
        </div>
      </header>

      <ArtistThemeSection artist={query.data} themes={themes} onPlayItem={onPlayItem} onPlayNextItem={onPlayNextItem} onAddToQueueItem={onAddToQueueItem} onReplaceQueueItem={onReplaceQueueItem} />
      <ArtistSongSection artist={query.data} themes={themes} songs={fullSongs} onPlayItem={onPlayItem} onPlayNextItem={onPlayNextItem} onAddToQueueItem={onAddToQueueItem} onReplaceQueueItem={onReplaceQueueItem} />
    </section>
  )
}

function ArtistArtwork({ artworkUrl, name }: { artworkUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  return <div className="artist-page__artwork">{artworkUrl && !failed ? <img src={artworkUrl} alt={`${name} artwork`} onError={() => setFailed(true)} /> : <span aria-hidden="true"><Disc3 size={64} /></span>}</div>
}

function ArtistThemeSection({ artist, themes, onPlayItem, onPlayNextItem, onAddToQueueItem, onReplaceQueueItem }: { artist: ArtistDetailResponse; themes: ArtistThemeDto[]; onPlayItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onPlayNextItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onAddToQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onReplaceQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void }) {
  return (
    <section className="artist-page__section" aria-labelledby="artist-themes-title">
      <div className="artist-page__section-heading"><div><p className="eyebrow">Opening and ending themes</p><h2 id="artist-themes-title">Themes</h2></div><span>{themes.length}</span></div>
      {themes.length === 0 ? <p className="catalog-empty">No ready themes are available for this artist yet.</p> : <ol className="artist-page__list">{themes.map((theme, index) => <ArtistThemeRow key={theme.id} theme={theme} onPlay={() => onPlayItem?.(artist, index)} onPlayNext={onPlayNextItem ? () => onPlayNextItem(artist, index) : undefined} onAddToQueue={onAddToQueueItem ? () => onAddToQueueItem(artist, index) : undefined} onReplaceQueue={onReplaceQueueItem ? () => onReplaceQueueItem(artist, index) : undefined} />)}</ol>}
    </section>
  )
}

function ArtistSongSection({ artist, themes, songs, onPlayItem, onPlayNextItem, onAddToQueueItem, onReplaceQueueItem }: { artist: ArtistDetailResponse; themes: ArtistThemeDto[]; songs: ArtistFullSongDto[]; onPlayItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onPlayNextItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onAddToQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void; onReplaceQueueItem?: (artist: ArtistDetailResponse, startIndex: number) => void }) {
  return (
    <section className="artist-page__section" aria-labelledby="artist-songs-title">
      <div className="artist-page__section-heading"><div><p className="eyebrow">Ready catalog tracks</p><h2 id="artist-songs-title">Full songs</h2></div><span>{songs.length}</span></div>
      {songs.length === 0 ? <p className="catalog-empty">No ready full songs are available for this artist yet.</p> : <ol className="artist-page__list">{songs.map((song, index) => { const itemIndex = themes.length + index; return <ArtistSongRow key={song.id} song={song} onPlay={() => onPlayItem?.(artist, itemIndex)} onPlayNext={onPlayNextItem ? () => onPlayNextItem(artist, itemIndex) : undefined} onAddToQueue={onAddToQueueItem ? () => onAddToQueueItem(artist, itemIndex) : undefined} onReplaceQueue={onReplaceQueueItem ? () => onReplaceQueueItem(artist, itemIndex) : undefined} /> })}</ol>}
    </section>
  )
}

function ArtistThemeRow({ theme, onPlay, onPlayNext, onAddToQueue, onReplaceQueue }: { theme: ArtistThemeDto; onPlay?: () => void; onPlayNext?: () => void; onAddToQueue?: () => void; onReplaceQueue?: () => void }) {
  const titlePreference = useAnimeTitlePreference()
  const anime = theme.anime ?? theme.kitsuAnimeIds.map((kitsuId) => ({ kitsuId, title: null, titleEn: null, posterUrl: null }))
  const state = theme.audioState ?? 'Available online'
  const navigate = useNavigate()
  const linkedAnime = anime.find((entry) => entry.kitsuId)
  const linkedAnimeTitle = preferredAnimeTitle(linkedAnime, titlePreference)
  const presentation = themePresentation({ animeTitle: linkedAnimeTitle, themeType: theme.themeType, songTitle: theme.title, artist: theme.artists.map((artist) => artist.name).join(', ') })
  const typeLabel = formatThemeType(theme.themeType)
  return <li className="artist-page__row"><button className="artist-page__row-play" type="button" disabled={!onPlay || !theme.audioUrl || theme.audioState === 'FAILED' || theme.audioState === 'MISSING'} onClick={onPlay} aria-label={`Play ${theme.title}`}><Play size={16} fill="currentColor" /></button><div className="artist-page__row-copy"><strong>{linkedAnime && linkedAnimeTitle ? <><Link to={`/anime/${encodeURIComponent(linkedAnime.kitsuId)}`}>{linkedAnimeTitle}</Link>{typeLabel ? ` · ${typeLabel}` : ''}</> : presentation.primary}</strong><small>{presentation.secondary}</small>{anime.length > 1 && <AnimeLinks anime={anime.slice(1)} />}</div><span className="artist-page__row-state">{state === 'READY' ? 'Ready' : state === 'MISSING' ? 'Unavailable' : state}</span><TrackActionMenu menuOnly item={{ itemType: 'THEME', itemId: theme.id, title: theme.title }} hasFullSize={Boolean(theme.mediaModes.fullSize)} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onReplaceQueue={onReplaceQueue} onGoToAnime={linkedAnime ? () => navigate(`/anime/${encodeURIComponent(linkedAnime.kitsuId)}`) : undefined} animeName={linkedAnimeTitle || undefined} onRelatedMusic={linkedAnime ? () => navigate(`/anime/${encodeURIComponent(linkedAnime.kitsuId)}/related-music`) : undefined} /></li>
}

function ArtistSongRow({ song, onPlay, onPlayNext, onAddToQueue, onReplaceQueue }: { song: ArtistFullSongDto; onPlay?: () => void; onPlayNext?: () => void; onAddToQueue?: () => void; onReplaceQueue?: () => void }) {
  const playable = song.audioAvailable !== false && Boolean(song.audioUrl)
  const navigate = useNavigate()
  const linkedAnime = song.anime?.find((entry) => entry.kitsuId)
  return <li className="artist-page__row"><button className="artist-page__row-play" type="button" disabled={!onPlay || !playable} onClick={onPlay} aria-label={`Play ${song.title}`}><Play size={16} fill="currentColor" /></button><div className="artist-page__row-copy"><strong>{song.title}</strong><small>{song.artistCredit || 'Unknown artist'}{song.releaseId ? <> · <Link to={`/release/${song.releaseId}`}>{song.releaseTitle || 'Release'}</Link></> : null}</small><AnimeLinks anime={song.anime ?? []} /></div><span className="artist-page__row-duration">{playable ? formatDuration(song.durationSeconds) : 'Metadata only'}</span><TrackActionMenu menuOnly item={{ itemType: 'SONG', itemId: song.id, title: song.title }} onPlayNext={playable ? onPlayNext : undefined} onAddToQueue={playable ? onAddToQueue : undefined} onReplaceQueue={playable ? onReplaceQueue : undefined} onGoToAnime={linkedAnime ? () => navigate(`/anime/${encodeURIComponent(linkedAnime.kitsuId)}`) : undefined} animeName={linkedAnime?.title || linkedAnime?.titleEn} onRelatedMusic={linkedAnime ? () => navigate(`/anime/${encodeURIComponent(linkedAnime.kitsuId)}/related-music`) : undefined} /></li>
}

function AnimeLinks({ anime }: { anime: ArtistAnimeLink[] }) {
  const titlePreference = useAnimeTitlePreference()
  const linked = anime.filter((entry) => entry.kitsuId && (entry.title || entry.titleEn))
  if (linked.length === 0) return null
  return <span className="artist-page__row-anime">{linked.map((entry, index) => <span key={entry.kitsuId}>{index > 0 && ', '}<Link to={`/anime/${encodeURIComponent(entry.kitsuId)}`}>{preferredAnimeTitle(entry, titlePreference)}</Link></span>)}</span>
}

function animeCount(themes: ArtistThemeDto[], songs: ArtistFullSongDto[]): number {
  const ids = new Set<string>()
  for (const item of [...themes, ...songs]) for (const anime of item.anime ?? []) if (anime.kitsuId) ids.add(anime.kitsuId)
  return ids.size
}

function collectionPlaylistItems(themes: readonly ArtistThemeDto[], songs: readonly ArtistFullSongDto[]): PlaylistItemInput[] {
  const seen = new Set<string>()
  return [...themes.map((theme) => ({ itemType: 'THEME' as const, itemId: theme.id, modeOverride: null })), ...songs.map((song) => ({ itemType: 'SONG' as const, itemId: song.id, modeOverride: null }))].filter((item) => {
    const key = `${item.itemType}:${item.itemId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--'
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
