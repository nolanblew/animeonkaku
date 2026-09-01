import { ChevronDown, Ellipsis, GripVertical, ListMusic, Maximize, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Trash2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { usePlayer } from './PlayerProvider'
import type { PlaybackMode } from '../media/modeSwitch'
import { CurrentTrackActions } from './CurrentTrackActions'
import type { QueueEntry } from './queue'
import { windowQueueEntries } from './queueWindow'
import { useAccessibleFocusScope } from '../components/focusScope'
import { themePresentation } from '../lib/themePresentation'
import { preferredAnimeTitle, useAnimeTitlePreference } from '../lib/animeTitlePreference'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { artistRouteSlug } from '../lib/navigation'

export interface NowPlayingViewProps { className?: string; onCollapse?: () => void }
const EMPTY_QUEUE_ENTRIES: QueueEntry[] = []

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
    <section className={['player-now-playing', isVideo ? 'player-now-playing--video' : 'player-now-playing--song', queueOpen && 'player-now-playing--queue-open', className].filter(Boolean).join(' ')} aria-label="Now playing" data-testid="now-playing-view">
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

      </div>
      {queueOpen && <PlaybackQueue onClose={() => setQueueOpen(false)} />}
    </section>
  )

  function ModeTab({ mode, label, available }: { mode: PlaybackMode; label: string; available: boolean }) {
    if (!available) return null
    return <button type="button" role="tab" aria-selected={player.mode === mode} onClick={() => player.setMode(mode)}>{label}</button>
  }
}

function PlaybackQueue({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const titlePreference = useAnimeTitlePreference()
  const [menuEntryId, setMenuEntryId] = useState<number | null>(null)
  const [historyVisibleCount, setHistoryVisibleCount] = useState(3)
  const [upcomingVisibleCount, setUpcomingVisibleCount] = useState(40)
  const [draggingEntryId, setDraggingEntryId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [dragPreview, setDragPreview] = useState<QueueEntry[] | null>(null)
  const touchStartY = useRef<number | null>(null)
  const rowElementsRef = useRef(new Map<number, HTMLLIElement>())
  const previousRectsRef = useRef(new Map<number, DOMRect>())
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
  const history = player.queueState.historyEntries ?? EMPTY_QUEUE_ENTRIES
  const current = entries[currentIndex]
  const upcoming = entries.slice(currentIndex + 1)
  const displayedUpcoming = dragPreview ?? upcoming
  const historyWindow = useMemo(() => windowQueueEntries(history, { anchor: history.length - 1, viewportSize: historyVisibleCount, overscan: 0 }), [history, historyVisibleCount])
  const upcomingWindow = useMemo(() => windowQueueEntries(displayedUpcoming, { anchor: 0, viewportSize: upcomingVisibleCount, overscan: 8 }), [displayedUpcoming, upcomingVisibleCount])
  const menuEntry = [...history, ...(current ? [current] : []), ...upcoming].find((entry) => entry.queueId === menuEntryId)
  const menuRef = useAccessibleFocusScope<HTMLDivElement>({ active: menuEntry !== undefined, onEscape: () => setMenuEntryId(null) })

  useEffect(() => {
    setHistoryVisibleCount(3)
    setUpcomingVisibleCount(40)
    setDragPreview(null)
  }, [entries, history])

  useLayoutEffect(() => {
    if (draggingEntryId === null) return
    for (const entry of displayedUpcoming) {
      const row = rowElementsRef.current.get(entry.queueId)
      const previous = previousRectsRef.current.get(entry.queueId)
      if (!row || !previous) continue
      const next = row.getBoundingClientRect()
      const delta = previous.top - next.top
      if (Math.abs(delta) < 1) continue
      row.style.transition = 'none'
      row.style.transform = `translateY(${delta}px)`
      requestAnimationFrame(() => {
        row.style.transition = ''
        row.style.transform = ''
      })
    }
    previousRectsRef.current.clear()
  }, [displayedUpcoming, draggingEntryId])

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

  const finishDrag = (commit: boolean) => {
    const drag = dragRef.current
    if (drag?.holdTimer) clearTimeout(drag.holdTimer)
    if (commit && drag?.active && drag.targetId !== null && drag.targetId !== drag.queueId) {
      player.queue.moveEntry(drag.queueId, drag.targetId)
    }
    dragRef.current = null
    setDraggingEntryId(null)
    setDropTargetId(null)
    setDragPreview(null)
  }

  const updateDropTarget = (clientX: number, clientY: number) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-queue-id]')
    const targetId = row ? Number(row.dataset.queueId) : null
    const validTargetId = Number.isFinite(targetId) ? targetId : null
    if (dragRef.current) dragRef.current.targetId = validTargetId
    setDropTargetId(validTargetId)
    const sourceId = dragRef.current?.queueId
    if (sourceId !== undefined) {
      for (const item of upcoming) {
        const element = rowElementsRef.current.get(item.queueId)
        if (element) previousRectsRef.current.set(item.queueId, element.getBoundingClientRect())
      }
      setDragPreview(validTargetId !== null && validTargetId !== sourceId ? reorderPreview(upcoming, sourceId, validTargetId) : null)
    }
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
      finishDrag(true)
      cleanup()
    }
    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== drag.pointerId) return
      finishDrag(false)
      cleanup()
    }
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || dragRef.current !== drag) return
      keyEvent.preventDefault()
      finishDrag(false)
      cleanup()
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown)
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null
    }
    dragCleanupRef.current?.()
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown)
  }

  return (
    <aside id="playback-queue" className="player-queue" aria-label="Playback queue">
      <div className="player-queue__heading">
        <div><p className="player-eyebrow">Queue</p><h2>{player.queueState.contextLabel || 'Listening session'}</h2></div>
        <div className="player-queue__heading-actions"><span>{entries.length} items</span><button type="button" className="player-icon-button player-icon-button--quiet" onClick={onClose} aria-label="Close queue"><X size={18} /></button></div>
      </div>
      <p id="queue-reorder-instructions" className="sr-only">Drag from the reorder handle. On touch, press briefly before dragging. With a keyboard, use the Up and Down Arrow keys.</p>
      <div
        className="player-queue__scroll"
        tabIndex={0}
        aria-label="Scrollable playback queue"
        onScroll={(event) => {
          if (event.currentTarget.scrollTop <= 8 && historyWindow.start > 0) {
            setHistoryVisibleCount((currentCount) => Math.min(currentCount + 40, history.length))
          }
        }}
        onWheel={(event) => {
          if (event.deltaY < 0 && event.currentTarget.scrollTop <= 8 && historyWindow.start > 0) {
            setHistoryVisibleCount((currentCount) => Math.min(currentCount + 40, history.length))
          }
        }}
        onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null }}
        onTouchMove={(event) => {
          const currentY = event.touches[0]?.clientY
          if (currentY !== undefined && touchStartY.current !== null && currentY - touchStartY.current > 12 && event.currentTarget.scrollTop <= 8 && historyWindow.start > 0) {
            touchStartY.current = null
            setHistoryVisibleCount((currentCount) => Math.min(currentCount + 40, history.length))
          }
        }}
      >
        {history.length > 0 && <QueueSection title="History" footer={historyWindow.start > 0 ? <QueueWindowControl label="older history" shown={historyWindow.entries.length} total={history.length} onClick={() => setHistoryVisibleCount((currentCount) => Math.min(currentCount + 40, history.length))} /> : undefined}>
          {historyWindow.entries.map((entry, index) => { const historyIndex = historyWindow.start + index; return <QueueRow key={`history-${entry.queueId}`} entry={entry} tone="history" position={historyIndex + 1} titlePreference={titlePreference} primaryLabel={`Replay ${entry.item.title}`} onPrimary={() => player.queue.rewindTo(historyIndex)} onMore={() => setMenuEntryId((open) => open === entry.queueId ? null : entry.queueId)} menuOpen={menuEntryId === entry.queueId} menu={menuEntryId === entry.queueId ? <div ref={menuRef} className="player-queue__row-menu" role="menu" aria-label={`${entry.item.title} queue actions`}><strong>{entry.item.title}</strong><QueueDestinationActions item={entry.item} onClose={() => setMenuEntryId(null)} /><button type="button" role="menuitem" onClick={() => setMenuEntryId(null)}>Close</button></div> : undefined} /> })}
        </QueueSection>}
        {current && <QueueSection title="Now playing">
          <QueueRow entry={current} tone="current" position={currentIndex + 1} titlePreference={titlePreference} onMore={() => setMenuEntryId((open) => open === current.queueId ? null : current.queueId)} menuOpen={menuEntryId === current.queueId} menu={menuEntryId === current.queueId ? <div ref={menuRef} className="player-queue__row-menu" role="menu" aria-label={`${current.item.title} queue actions`}><strong>{current.item.title}</strong><QueueDestinationActions item={current.item} onClose={() => setMenuEntryId(null)} /><button type="button" role="menuitem" onClick={() => setMenuEntryId(null)}>Close</button></div> : undefined} />
        </QueueSection>}
        <QueueSection title="Up next" footer={upcomingWindow.endExclusive < upcoming.length ? <QueueWindowControl label="queue" shown={upcomingWindow.endExclusive} total={upcoming.length} onClick={() => setUpcomingVisibleCount((currentCount) => Math.min(currentCount + 40, upcoming.length))} /> : undefined}>
          {displayedUpcoming.length === 0
            ? <p className="player-muted">The queue is empty.</p>
            : upcomingWindow.entries.map((entry, windowOffset) => {
              const offset = upcomingWindow.start + windowOffset
              const absoluteIndex = currentIndex + offset + 1
              const previous = displayedUpcoming[offset - 1]
              const next = displayedUpcoming[offset + 1]
              return <QueueRow
                key={entry.queueId}
                entry={entry}
                tone="upcoming"
                position={absoluteIndex + 1}
                titlePreference={titlePreference}
                primaryLabel={`Play ${entry.item.title}`}
                onPrimary={() => player.skipTo(absoluteIndex)}
                onMore={() => setMenuEntryId((open) => open === entry.queueId ? null : entry.queueId)}
                menuOpen={menuEntryId === entry.queueId}
                menu={menuEntryId === entry.queueId ? <div ref={menuRef} className="player-queue__row-menu" role="menu" aria-label={`${entry.item.title} queue actions`}>
                  <strong>{entry.item.title}</strong>
                  {!player.isQueueEntryEligible(entry.queueId) && <button type="button" role="menuitem" onClick={() => { player.queue.unskipEntry(entry.queueId); setMenuEntryId(null) }}>Play this disliked item</button>}
                   <button type="button" role="menuitem" onClick={() => { player.queue.moveToPlayNext(entry.queueId); setMenuEntryId(null) }}>Play next</button>
                   <button type="button" role="menuitem" onClick={() => { player.queue.addToQueue([entry.item]); setMenuEntryId(null) }}>Add another to queue</button>
                   <QueueDestinationActions item={entry.item} onClose={() => setMenuEntryId(null)} />
                   <button type="button" role="menuitem" className="player-queue__danger" onClick={() => { player.queue.removeEntry(entry.queueId); setMenuEntryId(null) }}><Trash2 size={15} /> Remove from queue</button>
                  <button type="button" role="menuitem" onClick={() => setMenuEntryId(null)}>Close</button>
                </div> : undefined}
                onDragStart={(event) => beginDrag(entry, event)}
                onDragKeyDown={(event) => {
                  const target = event.key === 'ArrowUp' ? previous : event.key === 'ArrowDown' ? next : undefined
                  if (!target) return
                  event.preventDefault()
                  player.queue.moveEntry(entry.queueId, target.queueId)
                }}
                dragging={draggingEntryId === entry.queueId}
                dropTarget={dropTargetId === entry.queueId && draggingEntryId !== entry.queueId}
                rowRef={(node) => { if (node) rowElementsRef.current.set(entry.queueId, node); else rowElementsRef.current.delete(entry.queueId) }}
              />
            })}
        </QueueSection>
      </div>
    </aside>
  )
}

function QueueWindowControl({ label, shown, total, onClick }: { label: string; shown: number; total: number; onClick: () => void }) {
  return <div className="player-queue__window-controls"><span>Showing {shown} of {total} {label} items.</span><button type="button" className="player-icon-button player-icon-button--quiet" onClick={onClick}>Load more</button></div>
}

function QueueDestinationActions({ item, onClose }: { item: QueueEntry['item']; onClose: () => void }) {
  const inRouter = useInRouterContext()
  if (inRouter) return <QueueDestinationActionsWithRouter item={item} onClose={onClose} />
  return <QueueDestinationActionsContent item={item} onClose={onClose} onNavigate={navigateWithoutRouter} />
}

function QueueDestinationActionsWithRouter({ item, onClose }: { item: QueueEntry['item']; onClose: () => void }) {
  const navigate = useNavigate()
  return <QueueDestinationActionsContent item={item} onClose={onClose} onNavigate={navigate} />
}

function QueueDestinationActionsContent({ item, onClose, onNavigate }: { item: QueueEntry['item']; onClose: () => void; onNavigate: (to: string) => void }) {
  const artist = item.artist?.trim()
  const artistSlug = artistRouteSlug(artist)
  const animeId = item.animeId
  const animeTitle = typeof item.animeTitle === 'string' && item.animeTitle.trim() ? item.animeTitle.trim() : undefined
  return <>
    {artistSlug && <button type="button" role="menuitem" onClick={() => { onClose(); onNavigate(`/artist/${encodeURIComponent(artistSlug)}`) }}>{`Go to ${artist}`}</button>}
    {animeId !== undefined && animeId !== null && String(animeId).trim() && <button type="button" role="menuitem" onClick={() => { onClose(); onNavigate(`/anime/${encodeURIComponent(String(animeId))}`) }}>{`Go to ${animeTitle ?? 'anime'}`}</button>}
  </>
}

function navigateWithoutRouter(to: string): void {
  if (typeof window === 'undefined') return
  window.history.pushState({}, '', to)
}

function QueueSection({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="player-queue__section">
    <div className="player-queue__section-heading"><h3 id={`queue-${title.toLowerCase().replace(/\s+/g, '-')}`}>{title}</h3></div>
    <ol>{children}</ol>
    {footer}
  </div>
}

function QueueRow({ entry, tone, position, titlePreference, primaryLabel, onPrimary, onMore, onDragStart, onDragKeyDown, menuOpen = false, menu, dragging = false, dropTarget = false, rowRef }: {
  entry: QueueEntry
  tone: 'history' | 'current' | 'upcoming'
  position: number
  titlePreference?: 'ENGLISH' | 'ROMAJI' | 'JAPANESE'
  primaryLabel?: string
  onPrimary?: () => void
  onMore?: () => void
  onDragStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDragKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  menuOpen?: boolean
  menu?: ReactNode
  dragging?: boolean
  dropTarget?: boolean
  rowRef?: (node: HTMLLIElement | null) => void
}) {
  const presentation = playerItemPresentation(entry.item, titlePreference)
  const titleCopy = <strong className="player-queue__title">{presentation.primary}</strong>
  return <li ref={rowRef} className={`player-queue__row player-queue__row--${tone}${dragging ? ' player-queue__row--dragging' : ''}${dropTarget ? ' player-queue__row--drop-target' : ''}`} data-queue-id={tone === 'upcoming' ? entry.queueId : undefined}>
    {tone === 'upcoming' && <button type="button" className="player-queue__drag-handle" onPointerDown={onDragStart} onKeyDown={onDragKeyDown} aria-label={`Drag ${entry.item.title} to reorder`} aria-describedby="queue-reorder-instructions"><GripVertical size={16} /></button>}
    <span className="player-queue__index">{position}</span>
    <div className="player-queue__content">
      {onPrimary ? <button type="button" className="player-queue__primary" onClick={onPrimary} aria-label={primaryLabel}>{titleCopy}</button> : <div className="player-queue__primary" aria-current="true">{titleCopy}</div>}
      <div className="player-queue__meta"><small>{presentation.secondary}</small>
        {onMore && <div className="player-queue__row-actions">
          <button type="button" onClick={onMore} aria-label={`More actions for ${entry.item.title} in queue`} aria-haspopup="menu" aria-expanded={menuOpen}><Ellipsis size={17} /></button>
        </div>}
      </div>
    </div>
    {menu}
  </li>
}

function reorderPreview(entries: QueueEntry[], sourceId: number, targetId: number): QueueEntry[] {
  const sourceIndex = entries.findIndex((entry) => entry.queueId === sourceId)
  const targetIndex = entries.findIndex((entry) => entry.queueId === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return entries
  const preview = [...entries]
  const [source] = preview.splice(sourceIndex, 1)
  preview.splice(targetIndex, 0, source)
  return preview
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
