import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useRovingMenu } from '../../components/focusScope'
import { ViewportMenu } from '../../components/ViewportMenu'
import type { PlaylistDto } from '../../lib/library'
import { PlaylistArtwork } from '../playlists'

export interface CatalogPlaylistCardProps {
  id: number
  name: string
  itemCount: number
  isAuto?: boolean
  isDynamic?: boolean
  artworkUrls: readonly string[]
  playlist?: PlaylistDto
  onPlay?: (playlist: PlaylistDto) => void
  onPlayNext?: (playlist: PlaylistDto) => void
  onAddToQueue?: (playlist: PlaylistDto) => void
}

export function CatalogPlaylistCard({ id, name, itemCount, isAuto, isDynamic, artworkUrls, playlist, onPlay, onPlayNext, onAddToQueue }: CatalogPlaylistCardProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRovingMenu<HTMLDivElement>({ open, onClose: () => setOpen(false), triggerRef })
  const navigate = useNavigate()
  const playlistPath = `/playlist/${id}`
  const trackLabel = `${itemCount} ${itemCount === 1 ? 'track' : 'tracks'}`
  const playlistKind = isDynamic ? 'Smart' : isAuto ? 'Auto' : null

  useEffect(() => {
    if (!open) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const run = (action: ((value: PlaylistDto) => void) | undefined) => {
    if (!playlist || !action) return
    setOpen(false)
    action(playlist)
  }

  return <article className="catalog-playlist-card" ref={rootRef}>
    <Link className="catalog-playlist-card__link" to={playlistPath} aria-label={`${name}, ${trackLabel}`}>
      <PlaylistArtwork playlistId={id} name={name} artworkUrls={artworkUrls} />
      <span className="catalog-playlist-card__copy"><strong title={name}>{name}</strong><small>{trackLabel}{playlistKind ? ` · ${playlistKind}` : ''}</small></span>
    </Link>
    <button
      ref={triggerRef}
      type="button"
      className="catalog-playlist-card__actions-trigger"
      aria-label={`More actions for ${name}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    ><MoreHorizontal size={20} /></button>
    <ViewportMenu open={open} triggerRef={triggerRef} menuRef={menuRef} className="catalog-playlist-card__actions-menu track-actions__menu" label={`${name} actions`}>
      <button type="button" role="menuitem" onClick={() => navigate(playlistPath)}>Open playlist</button>
      {onPlay && <button type="button" role="menuitem" disabled={!playlist || itemCount === 0} onClick={() => run(onPlay)}>Play playlist</button>}
      {onPlayNext && <button type="button" role="menuitem" disabled={!playlist || itemCount === 0} onClick={() => run(onPlayNext)}>Play next</button>}
      {onAddToQueue && <button type="button" role="menuitem" disabled={!playlist || itemCount === 0} onClick={() => run(onAddToQueue)}>Add to queue</button>}
    </ViewportMenu>
  </article>
}
