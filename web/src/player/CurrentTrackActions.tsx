import { useCallback, useSyncExternalStore } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { TrackActionMenu } from '../features/libraryactions'
import type { NormalizedLibrary } from '../lib/library'
import { artistRouteSlug } from '../lib/navigation'
import { LIBRARY_QUERY_KEY, queryClient } from '../lib/query'
import type { PlayerQueueItem } from './mapping'
import { usePlayer } from './PlayerProvider'
import { useLibraryActions } from '../features/libraryactions'

export function CurrentTrackActions() {
  if (useInRouterContext()) return <CurrentTrackActionsWithRouter />
  return <CurrentTrackActionsContent onNavigate={navigateWithoutRouter} />
}

function CurrentTrackActionsWithRouter() {
  const navigate = useNavigate()
  return <CurrentTrackActionsContent onNavigate={navigate} />
}

function CurrentTrackActionsContent({ onNavigate }: { onNavigate: (to: string) => void }) {
  const player = usePlayer()
  const libraryActions = useLibraryActions()
  const subscribeToLibrary = useCallback((onStoreChange: () => void) => queryClient.getQueryCache().subscribe(onStoreChange), [])
  const getLibrarySnapshot = useCallback(() => queryClient.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY), [])
  const library = useSyncExternalStore(subscribeToLibrary, getLibrarySnapshot, getLibrarySnapshot)
  const current = player.currentItem as PlayerQueueItem | undefined
  if (!current) return null
  const itemType = current.itemType === 'SONG' ? 'SONG' : 'THEME'
  const itemId = itemType === 'SONG' ? current.songId ?? Number(current.id) : current.themeId ?? Number(current.id)
  if (!Number.isInteger(itemId) || itemId <= 0) return null
  const preference = itemType === 'SONG' ? library?.songPrefsById[String(itemId)] : library?.prefsByThemeId[String(itemId)]
  const preferredMode = itemType === 'THEME' ? library?.prefsByThemeId[String(itemId)]?.preferredMode ?? null : null
  const animeId = current.animeId ?? (itemType === 'THEME' ? library?.themesById[String(itemId)]?.kitsuAnimeIds?.[0] : undefined)
  const artistSlug = artistRouteSlug(current.artist)
  return <TrackActionMenu
    key={`${itemType}:${itemId}`}
    item={{ itemType, itemId, title: current.title, modeOverride: itemType === 'THEME' && current.mode === 'FULL_SIZE' ? 'FULL_SIZE' : null }}
    liked={preference?.liked}
    disliked={preference?.disliked}
    onReplaceQueue={() => player.playItems([current], { contextLabel: 'Now playing', startIndex: 0, shuffle: false })}
    onPlayVideo={player.videoAvailable && Boolean(current.videoUrl) ? () => player.setMode('VIDEO') : undefined}
    onGoToArtist={artistSlug ? () => onNavigate(`/artist/${encodeURIComponent(artistSlug)}`) : undefined}
    onGoToAnime={animeId !== undefined && String(animeId).length > 0 ? () => onNavigate(`/anime/${encodeURIComponent(String(animeId))}`) : undefined}
    onRelatedMusic={animeId !== undefined && String(animeId).length > 0 ? () => onNavigate(`/anime/${encodeURIComponent(String(animeId))}/related-music`) : undefined}
    onSetPreferredMode={itemType === 'THEME' && player.fullSizeAvailable ? (mode) => { void libraryActions.setPreferredMode(itemId, mode) } : undefined}
    hasFullSize={itemType === 'THEME' && player.fullSizeAvailable}
    preferredMode={preferredMode}
  />
}

function navigateWithoutRouter(to: string): void {
  if (typeof window === 'undefined') return
  window.history.pushState({}, '', to)
}
