import { ChevronDown, ChevronUp, Ellipsis, GripVertical, ListMusic, Maximize, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { usePlayer } from './PlayerProvider'
import type { PlaybackMode } from '../media/modeSwitch'
import { CurrentTrackActions } from './CurrentTrackActions'
import type { QueueEntry } from './queue'
import { windowQueueEntries } from './queueWindow'
import { useAccessibleFocusScope } from '../components/focusScope'
import { themePresentation } from '../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../lib/animeTitlePreference'

export interface NowPlayingViewProps { className?: string; onCollapse?: () => void }

export function NowPlayingView({ className = '', onCollapse }: NowPlayingViewProps) {
  const player = usePlayer()
  const current = player.currentItem
  const animeTitlePreference = useAnimeTitlePreference()
  const presentation = playerItemPresentation(current, animeTitlePreference)
  const title = presentation.primary
  const artist = presentation.secondary
  const isVideo = player.mode === 'VIDEO'
  const [queueOpen, setQueueOpen] = useState(false)

  const modeLabel = player.mode === 'FULL_SIZE' ? 'Full size' : player.mode === 'VIDEO' ? 'Video' : 'TV size'
  return (
    <section className={['player-now-playing', isVideo ? 'player-now-playing--video' : 'player-now-playing--song', className].filter(Boolean).join(' ')} aria-label="Now playing" data-testid="now-playing-view">
      {current?.artworkUrl && <div className="player-now-playing__backdrop" style={{ backgroundImage: `url(${JSON.stringify(current.artworkUrl)})` }} aria-hidden="true" />}
      <div className="player-expanded-toolbar">
        <button type="button" className="player-collapse-button" onClick={onCollapse} disabled={!onCollapse} aria-label="Collapse player"><ChevronDown size={23} /></button>
        <div className="player-view-switch" role="tablist" aria-label="Playback type">
          <ModeTab mode="TV_SIZE" label="TV size" available={player.tvSizeAvailable} />
          <ModeTab mode="FULL_SIZE" label="Full size" available={player.fullSizeAvailable} />
          <ModeTab mode="VIDEO" label="Video" available={player.videoAvailable} />
        </div>
        {isVideo ? <button type="button" className="player-icon-button player-icon-button--quiet player-fullscreen-button" onClick={() => void player.requestFullscreen()} aria-label="Enter fullscreen"><Maximize size={18} /></button> : <span aria-hidden="true" />}
      </div>

      <div className="player-now-playing__body">
        <div className="player-now-playing__stage">
          {!isVideo && <div className="player-now-playing__artwork-wrap player-shared-artwork">{current?.artworkUrl ? <img className="player-now-playing__artwork" src={current.artworkUrl} alt="" /> : <div className="player-now-playing__artwork player-now-playing__artwork--fallback" aria-hidden="true">AO</div>}</div>}
          <div className="player-video-surface" ref={player.registerVideoSurface} data-testid="now-playing-video-surface" aria-label="Video surface" />
        </div>

        <div className="player-now-playing__details">
          <div className="player-now-playing__copy"><p className="player-eyebrow">Now playing</p><h2>{title}</h2><p>{artist}</p><span className="player-now-playing__type-label">{modeLabel}</span></div>
          <div className="player-now-playing__progress"><span aria-live="off">{formatTime(player.currentTime)}</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek" disabled={!current} /><span aria-live="off">{formatTime(player.duration)}</span></div>
          <div className="player-now-playing__controls" aria-label="Playback controls"><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.toggleShuffle()} aria-label={player.queueState.isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={player.queueState.isShuffled}><Shuffle size={20} /></button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.previous()} aria-label="Previous track" disabled={!current}><SkipBack size={24} fill="currentColor" /></button><button type="button" className="player-play-button player-play-button--hero" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'} disabled={!current}>{player.isPlaying ? <Pause size={29} fill="currentColor" /> : <Play size={29} fill="currentColor" />}</button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.next()} aria-label="Next track" disabled={!current}><SkipForward size={24} fill="currentColor" /></button><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.cycleRepeat()} aria-label={`Repeat ${player.queueState.repeatMode}`} aria-pressed={player.queueState.repeatMode !== 'off'}><Repeat size={20} /></button></div>
          <div className="player-now-playing__secondary-actions"><CurrentTrackActions /><button type="button" className="player-icon-button player-icon-button--quiet player-queue-toggle" onClick={() => setQueueOpen((open) => !open)} aria-label={queueOpen ? 'Hide queue' : 'Show queue'} aria-controls="playback-queue" aria-expanded={queueOpen}><ListMusic size={19} /></button></div>
          {player.error && <p className="player-error" role="alert">{player.error}</p>}
          {player.isLoading && <p className="player-loading" role="status">Loading media…</p>}
          {!player.videoAvailable && <p className="player-muted">Video unavailable for this theme.</p>}
        </div>

        {queueOpen && <PlaybackQueue onClose={() => setQueueOpen(false)} />}
      </div>
    </section>
  )

  function ModeTab({ mode, label, available }: { mode: PlaybackMode; label: string; available: boolean }) {
    if (!available) return null
    return <button type="button" role="tab" aria-selected={player.mode === mode} onClick={() => player.setMode(mode)}>{label}</button>
  }
}

function PlaybackQueue({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const [menuEntryId, setMenuEntryId] = useState<number | null>(null)
  const [historyVisibleCount, setHistoryVisibleCount] = useState(40)
  const [upcomingVisibleCount, setUpcomingVisibleCount] = useState(40)
  const [draggingEntryId, setDraggingEntryId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const dragRef = useRef<{
    queueId: number
    pointerId: number
    pointerType: string
    startX: number
    startY: number
    active: boolean
    targetId: number | null
    holdTimer?: ReturnType<typeof setTimeout>
  } | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const entries = player.queueState.nowPlayingEntries
  const currentIndex = player.queueState.currentIndex
  const history = player.queueState.historyEntries ?? []
  const current = entries[currentIndex]
  const upcoming = entries.slice(currentIndex + 1)
  const historyWindow = useMemo(() => windowQueueEntries(history, { anchor: 0, viewportSize: historyVisibleCount, overscan: 8 }), [history, historyVisibleCount])
  const upcomingWindow = useMemo(() => windowQueueEntries(upcoming, { anchor: 0, viewportSize: upcomingVisibleCount, overscan: 8 }), [upcoming, upcomingVisibleCount])
  const menuEntry = upcoming.find((entry) => entry.queueId === menuEntryId)
  const menuRef = useAccessibleFocusScope<HTMLDivElement>({ active: menuEntry !== undefined, onEscape: () => setMenuEntryId(null) })

  useEffect(() => {
    setHistoryVisibleCount(40)
    setUpcomingVisibleCount(40)
  }, [entries, history])

  useEffect(() => {
    if (!menuEntry) return undefined
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuEntryId(null)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [menuEntry, menuRef])

  useEffect(() => () => {
    if (dragRef.current?.holdTimer) clearTimeout(dragRef.current.holdTimer)
    dragCleanupRef.current?.()
  }, [])

  const finishDrag = () => {
    const drag = dragRef.current
    if (drag?.holdTimer) clearTimeout(drag.holdTimer)
    if (drag?.active && drag.targetId !== null && drag.targetId !== drag.queueId) {
      player.queue.moveEntry(drag.queueId, drag.targetId)
    }
    dragRef.current = null
    setDraggingEntryId(null)
    setDropTargetId(null)
  }

  const updateDropTarget = (clientX: number, clientY: number) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-queue-id]')
    const targetId = row ? Number(row.dataset.queueId) : null
    const validTargetId = Number.isFinite(targetId) ? targetId : null
    if (dragRef.current) dragRef.current.targetId = validTargetId
    setDropTargetId(validTargetId)
  }

  const beginDrag = (entry: QueueEntry, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const drag = {
      queueId: entry.queueId,
      pointerId: event.pointerId,
      pointerType: event.pointerType || 'mouse',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: null,
      holdTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    }
    dragRef.current = drag
    if (drag.pointerType === 'touch') {
      drag.holdTimer = setTimeout(() => {
        if (dragRef.current !== drag) return
        drag.active = true
        setDraggingEntryId(entry.queueId)
      }, 240)
    }

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (dragRef.current !== drag || pointerEvent.pointerId !== drag.pointerId) return
      const distance = Math.hypot(pointerEvent.clientX - drag.startX, pointerEvent.clientY - drag.startY)
      if (!drag.active) {
        if (drag.pointerType === 'touch') {
          if (distance > 9) {
            if (drag.holdTimer) clearTimeout(drag.holdTimer)
            dragRef.current = null
            cleanup()
          }
          return
        }
        if (distance < 6) return
        drag.active = true
        setDraggingEntryId(entry.queueId)
      }
      pointerEvent.preventDefault()
      updateDropTarget(pointerEvent.clientX, pointerEvent.clientY)
    }
    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return
      finishDrag()
      cleanup()
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null
    }
    dragCleanupRef.current?.()
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  return (
    <aside id="playback-queue" className="player-queue" aria-label="Playback queue">
      <div className="player-queue__heading">
        <div><p className="player-eyebrow">Queue</p><h2>{player.queueState.contextLabel || 'Listening session'}</h2></div>
        <div className="player-queue__heading-actions"><span>{entries.length} items</span><button type="button" className="player-icon-button player-icon-button--quiet" onClick={onClose} aria-label="Close queue"><X size={18} /></button></div>
      </div>
      <p id="queue-reorder-instructions" className="sr-only">Drag from the reorder handle. On touch, press briefly before dragging. You can also use the move up and move down buttons.</p>
      <div className="player-queue__scroll" tabIndex={0} aria-label="Scrollable playback queue">
        {history.length > 0 && <QueueSection title="History" footer={historyWindow.endExclusive < history.length ? <QueueWindowControl label="history" shown={historyWindow.endExclusive} total={history.length} onClick={() => setHistoryVisibleCount((currentCount) => Math.min(currentCount + 40, history.length))} /> : undefined}>
          {historyWindow.entries.map((entry, index) => { const historyIndex = historyWindow.start + index; return <QueueRow key={`history-${entry.queueId}`} entry={entry} tone="history" position={historyIndex + 1} primaryLabel={`Replay ${entry.item.title}`} onPrimary={() => player.queue.rewindTo(historyIndex)} /> })}
        </QueueSection>}
        {current && <QueueSection title="Now playing">
          <QueueRow entry={current} tone="current" position={currentIndex + 1} />
        </QueueSection>}
        <QueueSection title="Up next" footer={upcomingWindow.endExclusive < upcoming.length ? <QueueWindowControl label="queue" shown={upcomingWindow.endExclusive} total={upcoming.length} onClick={() => setUpcomingVisibleCount((currentCount) => Math.min(currentCount + 40, upcoming.length))} /> : undefined}>
          {upcoming.length === 0
            ? <p className="player-muted">The queue is empty.</p>
            : upcomingWindow.entries.map((entry, windowOffset) => {
              const offset = upcomingWindow.start + windowOffset
              const absoluteIndex = currentIndex + offset + 1
              const previous = upcoming[offset - 1]
              const afterNext = upcoming[offset + 2]
              return <QueueRow
                key={entry.queueId}
                entry={entry}
                tone="upcoming"
                position={absoluteIndex + 1}
                primaryLabel={`Play ${entry.item.title}`}
                onPrimary={() => player.skipTo(absoluteIndex)}
                onMoveUp={previous ? () => player.queue.moveEntry(entry.queueId, previous.queueId) : undefined}
                onMoveDown={upcoming[offset + 1] ? () => player.queue.moveEntry(entry.queueId, afterNext?.queueId) : undefined}
                onMore={() => setMenuEntryId((open) => open === entry.queueId ? null : entry.queueId)}
                menuOpen={menuEntryId === entry.queueId}
                onDragStart={(event) => beginDrag(entry, event)}
                dragging={draggingEntryId === entry.queueId}
                dropTarget={dropTargetId === entry.queueId && draggingEntryId !== entry.queueId}
              />
            })}
        </QueueSection>
      </div>
      {menuEntry && <div ref={menuRef} className="player-queue__menu" role="menu" aria-label={`${menuEntry.item.title} queue actions`}>
        <strong>{menuEntry.item.title}</strong>
        {!player.isQueueEntryEligible(menuEntry.queueId) && <button type="button" role="menuitem" onClick={() => { player.queue.unskipEntry(menuEntry.queueId); setMenuEntryId(null) }}>Play this disliked item</button>}
        <button type="button" role="menuitem" onClick={() => { player.queue.moveToPlayNext(menuEntry.queueId); setMenuEntryId(null) }}>Play next</button>
        <button type="button" role="menuitem" onClick={() => { player.queue.addToQueue([menuEntry.item]); setMenuEntryId(null) }}>Add another to queue</button>
        <button type="button" role="menuitem" className="player-queue__danger" onClick={() => { player.queue.removeEntry(menuEntry.queueId); setMenuEntryId(null) }}><Trash2 size={15} /> Remove from queue</button>
        <button type="button" role="menuitem" onClick={() => setMenuEntryId(null)}>Close</button>
      </div>}
    </aside>
  )
}

function QueueWindowControl({ label, shown, total, onClick }: { label: string; shown: number; total: number; onClick: () => void }) {
  return <div className="player-queue__window-controls"><span>Showing {shown} of {total} {label} items.</span><button type="button" className="player-icon-button player-icon-button--quiet" onClick={onClick}>Load more</button></div>
}

function QueueSection({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="player-queue__section">
    <div className="player-queue__section-heading"><h3 id={`queue-${title.toLowerCase().replace(/\s+/g, '-')}`}>{title}</h3></div>
    <ol>{children}</ol>
    {footer}
  </div>
}

function QueueRow({ entry, tone, position, primaryLabel, onPrimary, onMoveUp, onMoveDown, onMore, onDragStart, menuOpen = false, dragging = false, dropTarget = false }: {
  entry: QueueEntry
  tone: 'history' | 'current' | 'upcoming'
  position: number
  primaryLabel?: string
  onPrimary?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onMore?: () => void
  onDragStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  menuOpen?: boolean
  dragging?: boolean
  dropTarget?: boolean
}) {
  const presentation = playerItemPresentation(entry.item)
  const titleCopy = <><span className="player-queue__index">{position}</span><strong className="player-queue__title">{presentation.primary}</strong></>
  return <li className={`player-queue__row player-queue__row--${tone}${dragging ? ' player-queue__row--dragging' : ''}${dropTarget ? ' player-queue__row--drop-target' : ''}`} data-queue-id={tone === 'upcoming' ? entry.queueId : undefined}>
    {onPrimary ? <button type="button" className="player-queue__primary" onClick={onPrimary} aria-label={primaryLabel}>{titleCopy}</button> : <div className="player-queue__primary" aria-current="true">{titleCopy}</div>}
    <div className="player-queue__meta"><small>{presentation.secondary}</small>
      {tone === 'upcoming' && <div className="player-queue__row-actions">
        <button type="button" className="player-queue__drag-handle" onPointerDown={onDragStart} aria-label={`Drag ${entry.item.title} to reorder`} aria-describedby="queue-reorder-instructions"><GripVertical size={16} /></button>
        <button type="button" onClick={onMoveUp} disabled={!onMoveUp} aria-label={`Move ${entry.item.title} up`}><ChevronUp size={15} /></button>
        <button type="button" onClick={onMoveDown} disabled={!onMoveDown} aria-label={`Move ${entry.item.title} down`}><ChevronDown size={15} /></button>
        <button type="button" onClick={onMore} aria-label={`More actions for ${entry.item.title} in queue`} aria-haspopup="menu" aria-expanded={menuOpen}><Ellipsis size={17} /></button>
      </div>}
    </div>
  </li>
}

function playerItemPresentation(item: QueueEntry['item'] | undefined, preference?: 'ENGLISH' | 'ROMAJI' | 'JAPANESE'): { primary: string; secondary: string } {
  if (!item) return { primary: 'Nothing playing', secondary: 'Choose a theme or song to begin.' }
  if (item.itemType === 'THEME') return themePresentation({
    animeTitle: preferredAnimeTitle({ title: item.animeTitle as string | undefined, titleEn: item.animeTitleEn as string | undefined, titleRomaji: item.animeTitleRomaji as string | undefined, titleJa: item.animeTitleJa as string | undefined }, preference),
    themeType: item.themeType as string | undefined,
    songTitle: item.title,
    artist: item.artist,
  })
  return { primary: item.title, secondary: item.artist ?? item.album ?? 'Anime Ongaku' }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
