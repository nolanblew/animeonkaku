import { useEffect, useRef, useState } from 'react'
import { ListMusic, MoreHorizontal, Plus, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import type { PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import { listManualPlaylists, type PlaylistItemInput } from './api'
import { useLibraryActions } from './hooks'
import './libraryactions.css'

export interface TrackActionItem {
  itemType: 'THEME' | 'SONG'
  itemId: number
  title: string
  modeOverride?: PlaylistPlaybackMode | null
}

export interface TrackActionMenuProps {
  item: TrackActionItem
  liked?: boolean
  disliked?: boolean
  menuOnly?: boolean
  onPlayNext?: () => void
  onAddToQueue?: () => void
  onReplaceQueue?: () => void
  onPlayVideo?: () => void
  onGoToArtist?: () => void
  onGoToAnime?: () => void
  onRelatedMusic?: () => void
  onSetPreferredMode?: (mode: PlaylistPlaybackMode) => void
  hasFullSize?: boolean
  preferredMode?: PlaylistPlaybackMode | null
  artistName?: string | null
  animeName?: string | null
  onRemove?: () => void
  removeLabel?: string
}

export function TrackActionMenu({ item, liked = false, disliked = false, menuOnly = false, onPlayNext, onAddToQueue, onReplaceQueue, onPlayVideo, onGoToArtist, onGoToAnime, onRelatedMusic, onSetPreferredMode, hasFullSize = false, preferredMode = null, artistName, animeName, onRemove, removeLabel = 'Remove from playlist' }: TrackActionMenuProps) {
  const actions = useLibraryActions()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistDto[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const playlistItem: PlaylistItemInput = { itemType: item.itemType, itemId: item.itemId, modeOverride: item.itemType === 'THEME' ? item.modeOverride ?? null : null }

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const updatePreference = (kind: 'liked' | 'disliked', value: boolean) => {
    const patch = { [kind]: value }
    const request = item.itemType === 'SONG' ? actions.updateSongPreference(item.itemId, patch) : actions.updateThemePreference(item.itemId, patch)
    void request.catch(() => undefined)
  }
  const runAndClose = (action?: () => void) => { setOpen(false); action?.() }
  const openPicker = async () => {
    setOpen(false); setPickerOpen(true); setLoading(true); setPickerError(null)
    try { setPlaylists(await listManualPlaylists()) } catch { setPickerError('Could not load playlists.') } finally { setLoading(false) }
  }
  const choosePlaylist = async (playlistId: number) => {
    try { await actions.addItemsToPlaylist(playlistId, [playlistItem]); setPickerOpen(false) } catch { return }
  }
  const createPlaylist = async () => {
    try { await actions.createPlaylistWithItems(newName, [playlistItem]); setPickerOpen(false); setNewName('') } catch { return }
  }

  return <>
    <div className={menuOnly ? 'track-actions track-actions--menu-only' : 'track-actions'} ref={rootRef}>
      {!menuOnly && <>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label={disliked ? 'Remove dislike' : 'Dislike'} aria-pressed={disliked} disabled={actions.pendingAction === 'preference'} onClick={() => updatePreference('disliked', !disliked)}><ThumbsDown size={18} fill={disliked ? 'currentColor' : 'none'} /></button>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label={liked ? 'Remove like' : 'Like'} aria-pressed={liked} disabled={actions.pendingAction === 'preference'} onClick={() => updatePreference('liked', !liked)}><ThumbsUp size={18} fill={liked ? 'currentColor' : 'none'} /></button>
      </>}
      <button type="button" className="player-icon-button player-icon-button--quiet" aria-label={`More actions for ${item.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20} /></button>
      {open && <div className="track-actions__menu" role="menu" aria-label={`${item.title} actions`}>
        {onPlayNext && <button type="button" role="menuitem" onClick={() => runAndClose(onPlayNext)}>Play next</button>}
        {onAddToQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onAddToQueue)}>Add to queue</button>}
        {onReplaceQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onReplaceQueue)}>Replace queue</button>}
        <button type="button" role="menuitem" onClick={() => void openPicker()}>Save to playlist</button>
        {onPlayVideo && <button type="button" role="menuitem" onClick={() => runAndClose(onPlayVideo)}>Play Video</button>}
        {onGoToArtist && <button type="button" role="menuitem" onClick={() => runAndClose(onGoToArtist)}>{artistName ? `Go to ${artistName}` : 'Go to artist'}</button>}
        {onGoToAnime && <button type="button" role="menuitem" onClick={() => runAndClose(onGoToAnime)}>{animeName ? `Go to ${animeName}` : 'Go to anime'}</button>}
        {onRelatedMusic && <button type="button" role="menuitem" onClick={() => runAndClose(onRelatedMusic)}>Related Music</button>}
        {item.itemType === 'THEME' && hasFullSize && onSetPreferredMode && <button type="button" role="menuitem" onClick={() => runAndClose(() => onSetPreferredMode(preferredMode === 'FULL_SIZE' ? 'TV_SIZE' : 'FULL_SIZE'))}>{preferredMode === 'FULL_SIZE' ? 'Prefer TV Size' : 'Prefer Full Size'}</button>}
        {menuOnly && <><button type="button" role="menuitem" onClick={() => { updatePreference('liked', !liked); setOpen(false) }}>{liked ? 'Remove like' : 'Like'}</button><button type="button" role="menuitem" onClick={() => { updatePreference('disliked', !disliked); setOpen(false) }}>{disliked ? 'Remove dislike' : 'Dislike'}</button></>}
        {onRemove && <button type="button" role="menuitem" className="track-actions__danger" onClick={() => runAndClose(onRemove)}>{removeLabel}</button>}
      </div>}
      {actions.actionError && <span className="sr-only" role="alert">{actions.actionError}</span>}
    </div>
    {pickerOpen && <div className="library-actions__picker-scrim"><section className="library-actions library-actions--picker" role="dialog" aria-modal="true" aria-label="Save to playlist"><header className="library-actions__header"><div className="library-actions__art" aria-hidden="true"><ListMusic size={22} /></div><div><h2>Save to playlist</h2><p>{item.title}</p></div><button className="library-actions__close" type="button" aria-label="Close playlist picker" onClick={() => setPickerOpen(false)}><X size={20} /></button></header><div className="library-actions__new-playlist"><label htmlFor={`new-playlist-${item.itemType}-${item.itemId}`}>Create a new playlist</label><div><input id={`new-playlist-${item.itemType}-${item.itemId}`} aria-label="New playlist name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Playlist name" /><button type="button" aria-label="Create playlist" onClick={() => void createPlaylist()} disabled={!newName.trim() || actions.pendingAction === 'playlist'}><Plus size={18} /></button></div></div><div className="library-actions__playlists">{loading && <p role="status">Loading playlists</p>}{pickerError && <p role="alert" className="library-actions__error">{pickerError}</p>}{!loading && !pickerError && playlists.length === 0 && <p>No manual playlists yet. Create one above.</p>}{playlists.map((playlist) => <button key={playlist.id} type="button" onClick={() => void choosePlaylist(playlist.id)} disabled={actions.pendingAction === 'playlist'}><ListMusic size={18} /><span><strong>{playlist.name}</strong><small>{playlist.items.length || playlist.entries.length} tracks</small></span></button>)}</div></section></div>}
  </>
}
