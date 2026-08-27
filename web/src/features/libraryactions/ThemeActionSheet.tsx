import { useEffect, useRef, useState } from 'react'
import { Check, ListMusic, Music2, Play, Plus, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { useAccessibleFocusScope } from '../../components/focusScope'
import { listManualPlaylists } from './api'
import { useLibraryActions } from './hooks'
import type { PlaylistDto, PlaylistPlaybackMode } from '../../lib/library'
import './libraryactions.css'

export interface ThemeActionSheetProps {
  themeId: number
  selectedThemeIds?: readonly number[]
  title: string
  subtitle: string
  liked?: boolean
  disliked?: boolean
  preferredMode?: PlaylistPlaybackMode | null
  hasFullSize?: boolean
  inLibrary?: boolean
  inAnimeLibrary?: boolean
  animeKitsuId?: string
  animeThemesId?: number
  onPlay?: () => void
  onPlayNext?: () => void
  onAddToQueue?: () => void
  onClose: () => void
}

export function ThemeActionSheet({
  themeId,
  selectedThemeIds = [themeId],
  title,
  subtitle,
  liked = false,
  disliked = false,
  preferredMode = null,
  hasFullSize = false,
  inLibrary = true,
  inAnimeLibrary = false,
  animeKitsuId,
  animeThemesId,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onClose,
}: ThemeActionSheetProps) {
  const actions = useLibraryActions()
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistDto[]>([])
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistError, setPlaylistError] = useState<string | null>(null)
  const [modeOverride, setModeOverride] = useState<PlaylistPlaybackMode | null>(null)
  const [newPlaylistOpen, setNewPlaylistOpen] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [confirmingLibraryRemoval, setConfirmingLibraryRemoval] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const ids = selectedThemeIds.length > 0 ? selectedThemeIds : [themeId]
  const firstActionRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useAccessibleFocusScope<HTMLElement>({ onEscape: onClose, initialFocusRef: firstActionRef })

  useEffect(() => {
    if (!playlistOpen) return undefined
    let active = true
    setPlaylistLoading(true)
    setPlaylistError(null)
    void listManualPlaylists().then((result) => {
      if (active) setPlaylists(result)
    }).catch(() => {
      if (active) setPlaylistError('Could not load playlists.')
    }).finally(() => {
      if (active) setPlaylistLoading(false)
    })
    return () => { active = false }
  }, [playlistOpen])

  const choosePlaylist = async (playlistId: number) => {
    try {
      await actions.addThemesToPlaylist(playlistId, ids, modeOverride)
      setStatus('Saved to playlist.')
      setPlaylistOpen(false)
    } catch {
      return
    }
  }
  const createPlaylist = async () => {
    try {
      await actions.createPlaylistWithThemes(newPlaylistName, ids, modeOverride)
      setStatus('Playlist created and themes saved.')
      setPlaylistOpen(false)
      setNewPlaylistName('')
      setNewPlaylistOpen(false)
    } catch {
      return
    }
  }

  return (
    <>
      <div className="library-actions__scrim" onClick={onClose} aria-hidden="true" />
      <section ref={dialogRef} className="library-actions" role="dialog" aria-modal="true" aria-label={`${title} actions`}>
        <header className="library-actions__header"><div className="library-actions__art" aria-hidden="true"><Music2 size={22} /></div><div><h2 id="theme-actions-title">{title}</h2><p>{subtitle}</p></div><button className="library-actions__close" type="button" aria-label="Close actions" onClick={onClose}><X size={20} /></button></header>
        <div className="library-actions__primary"><ActionButton buttonRef={firstActionRef} icon={<Play size={18} fill="currentColor" />} label="Play now" onClick={onPlay} /><ActionButton icon={<Play size={18} />} label="Play next" onClick={onPlayNext} /><ActionButton icon={<ListMusic size={18} />} label="Add to queue" onClick={onAddToQueue} /><ActionButton icon={<Plus size={18} />} label="Save to playlist" onClick={() => setPlaylistOpen(true)} /></div>
        <div className="library-actions__list">
          <ActionRow icon={<ThumbsUp size={18} />} label={liked ? 'Remove like' : 'Like'} busy={actions.pendingAction === 'preference'} onClick={() => { void actions.updateThemePreference(themeId, { liked: !liked }).catch(() => undefined) }} />
          <ActionRow icon={<ThumbsDown size={18} />} label={disliked ? 'Remove dislike' : 'Dislike'} busy={actions.pendingAction === 'preference'} onClick={() => { void actions.updateThemePreference(themeId, { disliked: !disliked }).catch(() => undefined) }} />
          {hasFullSize && <ActionRow icon={<ListMusic size={18} />} label={preferredMode === 'FULL_SIZE' ? 'Prefer TV Size' : 'Prefer Full Size'} busy={actions.pendingAction === 'preference'} onClick={() => { void actions.setPreferredMode(themeId, preferredMode === 'FULL_SIZE' ? 'TV_SIZE' : 'FULL_SIZE').catch(() => undefined) }} />}
          {!inLibrary && <ActionRow icon={<Plus size={18} />} label="Add to library" busy={actions.pendingAction === 'library'} onClick={() => { void actions.addAnimeToLibrary({ kitsuId: animeKitsuId, animeThemesId: animeThemesId ?? themeId }).catch(() => undefined) }} />}
          {inAnimeLibrary && animeKitsuId && <ActionRow icon={<X size={18} />} label={confirmingLibraryRemoval ? 'Confirm remove anime' : 'Remove anime from library'} busy={actions.pendingAction === 'library'} onClick={() => {
            if (!confirmingLibraryRemoval) { setConfirmingLibraryRemoval(true); return }
            void actions.removeAnimeFromLibrary(animeKitsuId).then(() => setStatus('Anime removed from library.')).catch(() => undefined)
          }} />}
        </div>
        {confirmingLibraryRemoval && actions.pendingAction !== 'library' && <button className="library-actions__cancel-remove" type="button" onClick={() => setConfirmingLibraryRemoval(false)}>Cancel removal</button>}
        {status && <p className="library-actions__status" role="status">{status}</p>}
        {actions.actionError && <p className="library-actions__error" role="alert">{actions.actionError}</p>}
      </section>
      {playlistOpen && <PlaylistPicker playlists={playlists} loading={playlistLoading} error={playlistError} modeOverride={modeOverride} newPlaylistOpen={newPlaylistOpen} newPlaylistName={newPlaylistName} pending={actions.pendingAction === 'playlist'} onModeChange={setModeOverride} onClose={() => setPlaylistOpen(false)} onChoose={(playlistId) => void choosePlaylist(playlistId)} onNew={() => setNewPlaylistOpen(true)} onNameChange={setNewPlaylistName} onCreate={() => void createPlaylist()} />}
    </>
  )
}

function ActionButton({ buttonRef, icon, label, onClick }: { buttonRef?: React.RefObject<HTMLButtonElement | null>; icon: React.ReactNode; label: string; onClick?: () => void }) {
  return <button ref={buttonRef} className="library-actions__primary-button" type="button" onClick={onClick} disabled={!onClick}>{icon}<span>{label}</span></button>
}

function ActionRow({ icon, label, busy, onClick }: { icon: React.ReactNode; label: string; busy: boolean; onClick: () => void }) {
  return <button className="library-actions__row" type="button" onClick={onClick} disabled={busy}><span>{icon}</span><span>{busy ? 'Working…' : label}</span></button>
}

function PlaylistPicker({
  playlists,
  loading,
  error,
  modeOverride,
  newPlaylistOpen,
  newPlaylistName,
  pending,
  onModeChange,
  onClose,
  onChoose,
  onNew,
  onNameChange,
  onCreate,
}: {
  playlists: PlaylistDto[]
  loading: boolean
  error: string | null
  modeOverride: PlaylistPlaybackMode | null
  newPlaylistOpen: boolean
  newPlaylistName: string
  pending: boolean
  onModeChange: (mode: PlaylistPlaybackMode | null) => void
  onClose: () => void
  onChoose: (id: number) => void
  onNew: () => void
  onNameChange: (name: string) => void
  onCreate: () => void
}) {
  const dialogRef = useAccessibleFocusScope<HTMLElement>({ onEscape: onClose })

  return <div className="library-actions__picker-scrim"><section ref={dialogRef} className="library-actions library-actions--picker" role="dialog" aria-modal="true" aria-labelledby="playlist-picker-title"><header className="library-actions__header"><div className="library-actions__art" aria-hidden="true"><ListMusic size={22} /></div><div><h2 id="playlist-picker-title">Save to playlist</h2><p>Choose where these themes should live.</p></div><button className="library-actions__close" type="button" aria-label="Close playlist picker" onClick={onClose}><X size={20} /></button></header><div className="library-actions__mode"><span>Version for themes</span><div><button className={modeOverride === null ? 'is-selected' : ''} type="button" onClick={() => onModeChange(null)}>Use playlist default</button><button className={modeOverride === 'TV_SIZE' ? 'is-selected' : ''} type="button" onClick={() => onModeChange('TV_SIZE')}>TV Size</button><button className={modeOverride === 'FULL_SIZE' ? 'is-selected' : ''} type="button" onClick={() => onModeChange('FULL_SIZE')}>Full Size</button></div></div>{newPlaylistOpen ? <div className="library-actions__new-playlist"><label htmlFor="new-playlist-name">New playlist name</label><div><input id="new-playlist-name" aria-label="New playlist name" value={newPlaylistName} onChange={(event) => onNameChange(event.target.value)} autoFocus /><button type="button" aria-label="Create playlist" onClick={onCreate} disabled={pending || !newPlaylistName.trim()}><Check size={18} /></button></div></div> : <button className="library-actions__new" type="button" onClick={onNew}><Plus size={18} /> New playlist</button>}<div className="library-actions__playlists">{loading && <p role="status">Loading playlists</p>}{error && <p className="library-actions__error" role="alert">{error}</p>}{!loading && !error && playlists.length === 0 && <p>No manual playlists yet. Create one above.</p>}{!loading && !error && playlists.map((playlist) => <button key={playlist.id} type="button" aria-label={playlist.name} onClick={() => onChoose(playlist.id)} disabled={pending}><ListMusic size={18} /><span><strong>{playlist.name}</strong><small>{playlist.items.length || playlist.entries.length} tracks</small></span></button>)}</div></section></div>
}
