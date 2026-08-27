import { TrackActionMenu } from '../features/libraryactions'
import { LIBRARY_QUERY_KEY, queryClient } from '../lib/query'
import type { NormalizedLibrary } from '../lib/library'
import type { PlayerQueueItem } from './mapping'
import { usePlayer } from './PlayerProvider'

export function CurrentTrackActions() {
  const player = usePlayer()
  const current = player.currentItem as PlayerQueueItem | undefined
  if (!current) return null
  const itemType = current.itemType === 'SONG' ? 'SONG' : 'THEME'
  const itemId = itemType === 'SONG' ? current.songId ?? Number(current.id) : current.themeId ?? Number(current.id)
  if (!Number.isInteger(itemId) || itemId <= 0) return null
  const library = queryClient.getQueryData<NormalizedLibrary>(LIBRARY_QUERY_KEY)
  const preference = itemType === 'SONG' ? library?.songPrefsById[String(itemId)] : library?.prefsByThemeId[String(itemId)]
  return <TrackActionMenu item={{ itemType, itemId, title: current.title, modeOverride: itemType === 'THEME' && current.mode === 'FULL_SIZE' ? 'FULL_SIZE' : null }} liked={preference?.liked} disliked={preference?.disliked} onPlayNext={() => player.queue.playNext([current])} onAddToQueue={() => player.queue.addToQueue([current])} />
}
