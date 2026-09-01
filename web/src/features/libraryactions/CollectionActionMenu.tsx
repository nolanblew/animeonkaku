import { ListMusic, MoreHorizontal, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAccessibleFocusScope, useRovingMenu } from '../../components/focusScope'
import { ViewportMenu } from '../../components/ViewportMenu'
import type { PlaylistDto } from '../../lib/library'
import { listManualPlaylists, type PlaylistItemInput } from './api'
import { useLibraryActions } from './hooks'

export interface CollectionActionMenuProps {
  name: string
  items?: readonly PlaylistItemInput[]
  onPlayNext?: () => void
  onAddToQueue?: () => void
  onReplaceQueue?: () => void
  onRefresh?: () => void
  refreshLabel?: string
  onEdit?: () => void
  onDelete?: () => void
  excludePlaylistId?: number
}

export function CollectionActionMenu({ name, items = [], onPlayNext, onAddToQueue, onReplaceQueue, onRefresh, refreshLabel = 'Refresh now', onEdit, onDelete, excludePlaylistId }: CollectionActionMenuProps) {
  const actions = useLibraryActions()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistDto[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRovingMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef })
  const pickerRef = useAccessibleFocusScope<HTMLElement>({ active: pickerOpen, onEscape: () => setPickerOpen(false), restoreFocusRef: triggerRef })

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const runAndClose = (callback?: () => void) => { setOpen(false); callback?.() }
  const openPicker = async () => {
    setOpen(false)
    setPickerOpen(true)
    setLoading(true)
    setPickerError(null)
    try { setPlaylists((await listManualPlaylists()).filter((playlist) => playlist.id !== excludePlaylistId)) } catch { setPickerError('Could not load playlists.') } finally { setLoading(false) }
  }
  const choosePlaylist = async (playlistId: number) => {
    try { await actions.addItemsToPlaylist(playlistId, items); setPickerOpen(false) } catch { return }
  }
  const createPlaylist = async () => {
    try { await actions.createPlaylistWithItems(newName, items); setPickerOpen(false); setNewName('') } catch { return }
  }

  return <>
    <div className="collection-actions" ref={rootRef}>
      <button ref={triggerRef} type="button" className="button button--secondary collection-actions__trigger" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /> More</button>
      <ViewportMenu open={open} triggerRef={triggerRef} menuRef={menuRef} className="track-actions__menu collection-actions__menu" label={`${name} actions`}>
        {onPlayNext && <button type="button" role="menuitem" onClick={() => runAndClose(onPlayNext)}>Play next</button>}
        {onAddToQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onAddToQueue)}>Add to queue</button>}
        {onReplaceQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onReplaceQueue)}>Replace queue</button>}
        {items.length > 0 && <button type="button" role="menuitem" onClick={() => void openPicker()}>Add to playlist</button>}
        {onRefresh && <button type="button" role="menuitem" onClick={() => runAndClose(onRefresh)}>{refreshLabel}</button>}
        {onEdit && <button type="button" role="menuitem" onClick={() => runAndClose(onEdit)}>Edit playlist</button>}
        {onDelete && <button type="button" role="menuitem" className="track-actions__danger" onClick={() => runAndClose(onDelete)}>Delete playlist</button>}
      </ViewportMenu>
    </div>
    {pickerOpen && <div className="library-actions__picker-scrim"><section ref={pickerRef} className="library-actions library-actions--picker" role="dialog" aria-modal="true" aria-label="Add to playlist"><header className="library-actions__header"><div className="library-actions__art" aria-hidden="true"><ListMusic size={22} /></div><div><h2>Add to playlist</h2><p>{name}</p></div><button className="library-actions__close" type="button" aria-label="Close playlist picker" onClick={() => setPickerOpen(false)}><X size={20} /></button></header><div className="library-actions__new-playlist"><label htmlFor={`collection-playlist-${name}`}>Create a new playlist</label><div><input id={`collection-playlist-${name}`} aria-label="New playlist name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Playlist name" /><button type="button" aria-label="Create playlist" onClick={() => void createPlaylist()} disabled={!newName.trim() || actions.pendingAction === 'playlist'}><Plus size={18} /></button></div></div><div className="library-actions__playlists">{loading && <p role="status">Loading playlists</p>}{pickerError && <p role="alert" className="library-actions__error">{pickerError}</p>}{!loading && !pickerError && playlists.length === 0 && <p>No manual playlists yet. Create one above.</p>}{playlists.map((playlist) => <button key={playlist.id} type="button" onClick={() => void choosePlaylist(playlist.id)} disabled={actions.pendingAction === 'playlist'}><ListMusic size={18} /><span><strong>{playlist.name}</strong><small>{playlist.items.length || playlist.entries.length} tracks</small></span></button>)}</div>{actions.actionError && <p className="library-actions__error" role="alert">{actions.actionError}</p>}</section></div>}
  </>
}
