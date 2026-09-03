import { useEffect, useRef, useState } from 'react'
import { ListMusic, MoreHorizontal, Plus, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import type { PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import { useAccessibleFocusScope, useRovingMenu } from '../../components/focusScope'
import { ViewportMenu } from '../../components/ViewportMenu'
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
  dislikedTvSize?: boolean
  dislikedFullSize?: boolean
  activePlaybackMode?: PlaylistPlaybackMode | null
  menuOnly?: boolean
  onPlayNext?: () => void
  onAddToQueue?: () => void
  onReplaceQueue?: () => void
  /** Called immediately after a new dislike is selected (for active-player skip). */
  onDislike?: () => void
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

export function TrackActionMenu({ item, liked = false, disliked = false, dislikedTvSize = false, dislikedFullSize = false, activePlaybackMode = null, menuOnly = false, onPlayNext, onAddToQueue, onReplaceQueue, onDislike, onPlayVideo, onGoToArtist, onGoToAnime, onRelatedMusic, onSetPreferredMode, hasFullSize = false, preferredMode = null, artistName, animeName, onRemove, removeLabel = 'Remove from playlist' }: TrackActionMenuProps) {
  const actions = useLibraryActions()
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistDto[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [localLiked, setLocalLiked] = useState(Boolean(liked))
  const [localDisliked, setLocalDisliked] = useState(Boolean(disliked))
  const [localDislikedTvSize, setLocalDislikedTvSize] = useState(Boolean(dislikedTvSize))
  const [localDislikedFullSize, setLocalDislikedFullSize] = useState(Boolean(dislikedFullSize))
  const [dislikeScopeOpen, setDislikeScopeOpen] = useState(false)
  const optimisticPreference = useRef<{ liked: boolean; disliked: boolean; dislikedTvSize: boolean; dislikedFullSize: boolean } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressDislikeClick = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const dislikeTriggerRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRovingMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef })
  const dislikeScopeMenuRef = useRovingMenu<HTMLDivElement>({ open: dislikeScopeOpen, onClose: () => setDislikeScopeOpen(false), triggerRef: dislikeTriggerRef })
  const pickerRef = useAccessibleFocusScope<HTMLElement>({ active: pickerOpen, onEscape: () => setPickerOpen(false), restoreFocusRef: triggerRef })
  const playlistItem: PlaylistItemInput = { itemType: item.itemType, itemId: item.itemId, modeOverride: item.itemType === 'THEME' ? item.modeOverride ?? null : null }

  useEffect(() => {
    if (optimisticPreference.current) return
    setLocalLiked(Boolean(liked))
    setLocalDisliked(Boolean(disliked))
    setLocalDislikedTvSize(Boolean(dislikedTvSize))
    setLocalDislikedFullSize(Boolean(dislikedFullSize))
  }, [liked, disliked, dislikedTvSize, dislikedFullSize])

  useEffect(() => {
    if (!open && !dislikeScopeOpen) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target) && !dislikeScopeMenuRef.current?.contains(target)) {
        setOpen(false)
        setDislikeScopeOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open, dislikeScopeOpen])

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
  }, [])

  const updatePreference = (kind: 'liked' | 'disliked' | 'dislikedTvSize' | 'dislikedFullSize', value: boolean) => {
    const previous = { liked: localLiked, disliked: localDisliked, dislikedTvSize: localDislikedTvSize, dislikedFullSize: localDislikedFullSize }
    const next = { ...previous, [kind]: value }
    if (kind === 'liked' && value) {
      next.disliked = false
      next.dislikedTvSize = false
      next.dislikedFullSize = false
    }
    if (kind === 'disliked' && value) {
      next.liked = false
      next.dislikedTvSize = false
      next.dislikedFullSize = false
    }
    if ((kind === 'dislikedTvSize' || kind === 'dislikedFullSize') && value) {
      next.liked = false
      next.disliked = false
    }
    optimisticPreference.current = next
    setLocalLiked(next.liked)
    setLocalDisliked(next.disliked)
    setLocalDislikedTvSize(next.dislikedTvSize)
    setLocalDislikedFullSize(next.dislikedFullSize)
    if (kind !== 'liked' && value) onDislike?.()
    const patch = { [kind]: value }
    const request = item.itemType === 'SONG'
      ? actions.updateSongPreference(item.itemId, { [kind]: value } as { liked?: boolean; disliked?: boolean })
      : actions.updateThemePreference(item.itemId, patch)
    void request.then((result) => {
      if (optimisticPreference.current !== next) return
      optimisticPreference.current = null
      const confirmed = result as Partial<typeof next>
      setLocalLiked(confirmed.liked ?? next.liked)
      setLocalDisliked(confirmed.disliked ?? next.disliked)
      setLocalDislikedTvSize(confirmed.dislikedTvSize ?? next.dislikedTvSize)
      setLocalDislikedFullSize(confirmed.dislikedFullSize ?? next.dislikedFullSize)
    }).catch(() => {
      if (optimisticPreference.current !== next) return
      optimisticPreference.current = null
      setLocalLiked(previous.liked)
      setLocalDisliked(previous.disliked)
      setLocalDislikedTvSize(previous.dislikedTvSize)
      setLocalDislikedFullSize(previous.dislikedFullSize)
    })
  }
  const hasDislikeScopes = item.itemType === 'THEME' && hasFullSize
  const currentDisliked = localDisliked || (activePlaybackMode === 'TV_SIZE' && localDislikedTvSize) || (activePlaybackMode === 'FULL_SIZE' && localDislikedFullSize)
  const openDislikeScopes = () => {
    if (!hasDislikeScopes) return
    setOpen(false)
    setDislikeScopeOpen(true)
  }
  const clearLongPress = () => {
    if (!longPressTimer.current) return
    clearTimeout(longPressTimer.current)
    longPressTimer.current = null
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
        <button
          ref={dislikeTriggerRef}
          type="button"
          className="player-icon-button player-icon-button--quiet"
          aria-label={currentDisliked ? 'Remove dislike' : 'Dislike'}
          aria-pressed={currentDisliked}
          aria-haspopup={hasDislikeScopes ? 'menu' : undefined}
          aria-expanded={hasDislikeScopes ? dislikeScopeOpen : undefined}
          disabled={actions.pendingAction === 'preference'}
          onClick={() => {
            if (suppressDislikeClick.current) { suppressDislikeClick.current = false; return }
            updatePreference('disliked', !localDisliked)
          }}
          onContextMenu={(event) => { if (hasDislikeScopes) { event.preventDefault(); openDislikeScopes() } }}
          onPointerDown={(event) => {
            if (!hasDislikeScopes || event.pointerType !== 'touch') return
            clearLongPress()
            longPressTimer.current = setTimeout(() => { longPressTimer.current = null; suppressDislikeClick.current = true; openDislikeScopes() }, 500)
          }}
          onPointerUp={clearLongPress}
          onPointerCancel={clearLongPress}
          onPointerLeave={clearLongPress}
        ><ThumbsDown size={18} fill={currentDisliked ? 'currentColor' : 'none'} /></button>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label={localLiked ? 'Remove like' : 'Like'} aria-pressed={localLiked} disabled={actions.pendingAction === 'preference'} onClick={() => updatePreference('liked', !localLiked)}><ThumbsUp size={18} fill={localLiked ? 'currentColor' : 'none'} /></button>
      </>}
      <button ref={triggerRef} type="button" className="player-icon-button player-icon-button--quiet" aria-label={`More actions for ${item.title}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20} /></button>
      <ViewportMenu open={dislikeScopeOpen} triggerRef={dislikeTriggerRef} menuRef={dislikeScopeMenuRef} className="track-actions__menu track-actions__dislike-scope-menu" label={`Choose dislike scope for ${item.title}`}>
        <button type="button" role="menuitem" onClick={() => { updatePreference('dislikedTvSize', !localDislikedTvSize); setDislikeScopeOpen(false) }}>{localDislikedTvSize ? 'Remove TV Size Dislike' : 'Dislike TV Size'}</button>
        <button type="button" role="menuitem" onClick={() => { updatePreference('dislikedFullSize', !localDislikedFullSize); setDislikeScopeOpen(false) }}>{localDislikedFullSize ? 'Remove Full Size Dislike' : 'Dislike Full Size'}</button>
      </ViewportMenu>
      <ViewportMenu open={open} triggerRef={triggerRef} menuRef={menuRef} className="track-actions__menu" label={`${item.title} actions`}>
        {onPlayNext && <button type="button" role="menuitem" onClick={() => runAndClose(onPlayNext)}>Play next</button>}
        {onAddToQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onAddToQueue)}>Add to queue</button>}
        {onReplaceQueue && <button type="button" role="menuitem" onClick={() => runAndClose(onReplaceQueue)}>Replace queue</button>}
        <button type="button" role="menuitem" onClick={() => void openPicker()}>Save to playlist</button>
        {onPlayVideo && <button type="button" role="menuitem" onClick={() => runAndClose(onPlayVideo)}>Play Video</button>}
        {onGoToArtist && <button type="button" role="menuitem" onClick={() => runAndClose(onGoToArtist)}>{artistName ? `Go to ${artistName}` : 'Go to artist'}</button>}
        {onGoToAnime && <button type="button" role="menuitem" onClick={() => runAndClose(onGoToAnime)}>{animeName ? `Go to ${animeName}` : 'Go to anime'}</button>}
        {onRelatedMusic && <button type="button" role="menuitem" onClick={() => runAndClose(onRelatedMusic)}>Related Music</button>}
        {item.itemType === 'THEME' && hasFullSize && onSetPreferredMode && <button type="button" role="menuitem" onClick={() => runAndClose(() => onSetPreferredMode(preferredMode === 'FULL_SIZE' ? 'TV_SIZE' : 'FULL_SIZE'))}>{preferredMode === 'FULL_SIZE' ? 'Prefer TV Size' : 'Prefer Full Size'}</button>}
        {menuOnly && <><button type="button" role="menuitem" onClick={() => { updatePreference('liked', !localLiked); setOpen(false) }}>{localLiked ? 'Remove like' : 'Like'}</button><button type="button" role="menuitem" onClick={() => { updatePreference('disliked', !localDisliked); setOpen(false) }}>{localDisliked ? 'Remove dislike' : 'Dislike'}</button></>}
        {onRemove && <button type="button" role="menuitem" className="track-actions__danger" onClick={() => runAndClose(onRemove)}>{removeLabel}</button>}
      </ViewportMenu>
      {actions.actionError && <span className="sr-only" role="alert">{actions.actionError}</span>}
    </div>
    {pickerOpen && <div className="library-actions__picker-scrim"><section ref={pickerRef} className="library-actions library-actions--picker" role="dialog" aria-modal="true" aria-label="Save to playlist"><header className="library-actions__header"><div className="library-actions__art" aria-hidden="true"><ListMusic size={22} /></div><div><h2>Save to playlist</h2><p>{item.title}</p></div><button className="library-actions__close" type="button" aria-label="Close playlist picker" onClick={() => setPickerOpen(false)}><X size={20} /></button></header><div className="library-actions__new-playlist"><label htmlFor={`new-playlist-${item.itemType}-${item.itemId}`}>Create a new playlist</label><div><input id={`new-playlist-${item.itemType}-${item.itemId}`} aria-label="New playlist name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Playlist name" /><button type="button" aria-label="Create playlist" onClick={() => void createPlaylist()} disabled={!newName.trim() || actions.pendingAction === 'playlist'}><Plus size={18} /></button></div></div><div className="library-actions__playlists">{loading && <p role="status">Loading playlists</p>}{pickerError && <p role="alert" className="library-actions__error">{pickerError}</p>}{!loading && !pickerError && playlists.length === 0 && <p>No manual playlists yet. Create one above.</p>}{playlists.map((playlist) => <button key={playlist.id} type="button" onClick={() => void choosePlaylist(playlist.id)} disabled={actions.pendingAction === 'playlist'}><ListMusic size={18} /><span><strong>{playlist.name}</strong><small>{playlist.items.length || playlist.entries.length} tracks</small></span></button>)}</div></section></div>}
  </>
}
