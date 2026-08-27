import { ChevronDown, ChevronUp, Ellipsis, Maximize, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { usePlayer } from './PlayerProvider'
import type { PlaybackMode } from '../media/modeSwitch'
import { CurrentTrackActions } from './CurrentTrackActions'
import type { QueueEntry } from './queue'

export interface NowPlayingViewProps { className?: string; onCollapse?: () => void }

export function NowPlayingView({ className = '', onCollapse }: NowPlayingViewProps) {
  const player = usePlayer()
  const current = player.currentItem
  const title = current?.title ?? 'Nothing playing'
  const artist = current?.artist ?? 'Choose a theme or song to begin.'
  const isVideo = player.mode === 'VIDEO'

  const chooseSong = () => player.setMode(player.fullSizeAvailable ? 'FULL_SIZE' : 'TV_SIZE')
  return (
    <section className={['player-now-playing', isVideo ? 'player-now-playing--video' : 'player-now-playing--song', className].filter(Boolean).join(' ')} aria-label="Now playing" data-testid="now-playing-view">
      {current?.artworkUrl && <div className="player-now-playing__backdrop" style={{ backgroundImage: `url(${JSON.stringify(current.artworkUrl)})` }} aria-hidden="true" />}
      <div className="player-expanded-toolbar">
        <button type="button" className="player-collapse-button" onClick={onCollapse} disabled={!onCollapse} aria-label="Collapse player"><ChevronDown size={23} /></button>
        <div className="player-view-switch" role="tablist" aria-label="Player view">
          <button type="button" role="tab" aria-selected={!isVideo} onClick={chooseSong} disabled={!player.tvSizeAvailable && !player.fullSizeAvailable}>Song</button>
          <button type="button" role="tab" aria-selected={isVideo} onClick={() => player.setMode('VIDEO')} disabled={!player.videoAvailable}>Video</button>
        </div>
        <span aria-hidden="true" />
      </div>

      <div className="player-now-playing__body">
        <div className="player-now-playing__stage">
          {!isVideo && <div className="player-now-playing__artwork-wrap player-shared-artwork">{current?.artworkUrl ? <img className="player-now-playing__artwork" src={current.artworkUrl} alt="" /> : <div className="player-now-playing__artwork player-now-playing__artwork--fallback" aria-hidden="true">AO</div>}</div>}
          <div className="player-video-surface" ref={player.registerVideoSurface} data-testid="now-playing-video-surface" aria-label="Video surface" />
        </div>

        <div className="player-now-playing__details">
          <div className="player-now-playing__copy"><p className="player-eyebrow">Now playing</p><h2>{title}</h2><p>{artist}</p></div>
          <div className="player-now-playing__secondary-actions"><CurrentTrackActions /></div>
          <div className="player-now-playing__progress"><span aria-live="off">{formatTime(player.currentTime)}</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek" disabled={!current} /><span aria-live="off">{formatTime(player.duration)}</span></div>
          <div className="player-now-playing__controls" aria-label="Playback controls"><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.toggleShuffle()} aria-label={player.queueState.isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={player.queueState.isShuffled}><Shuffle size={20} /></button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.previous()} aria-label="Previous track" disabled={!current}><SkipBack size={24} fill="currentColor" /></button><button type="button" className="player-play-button player-play-button--hero" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'} disabled={!current}>{player.isPlaying ? <Pause size={29} fill="currentColor" /> : <Play size={29} fill="currentColor" />}</button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.next()} aria-label="Next track" disabled={!current}><SkipForward size={24} fill="currentColor" /></button><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.cycleRepeat()} aria-label={`Repeat ${player.queueState.repeatMode}`} aria-pressed={player.queueState.repeatMode !== 'off'}><Repeat size={20} /></button></div>
          <div className="player-mode-controls" role="group" aria-label="Playback size"><ModeButton mode="TV_SIZE" label="TV size" disabled={!player.tvSizeAvailable} /><ModeButton mode="FULL_SIZE" label="Full size" disabled={!player.fullSizeAvailable} /><ModeButton mode="VIDEO" label="Video" disabled={!player.videoAvailable} />{isVideo && <button type="button" className="player-icon-button" onClick={() => void player.requestFullscreen()} aria-label="Enter fullscreen"><Maximize size={18} /></button>}</div>
          {player.error && <p className="player-error" role="alert">{player.error}</p>}
          {player.isLoading && <p className="player-loading" role="status">Loading media…</p>}
          {!player.videoAvailable && <p className="player-muted">Video unavailable for this theme.</p>}
        </div>

        <PlaybackQueue />
      </div>
    </section>
  )

  function ModeButton({ mode, label, disabled = false }: { mode: PlaybackMode; label: string; disabled?: boolean }) {
    return <button type="button" className="player-mode-button" onClick={() => player.setMode(mode)} aria-pressed={player.mode === mode} disabled={disabled}>{label}</button>
  }
}

function PlaybackQueue() {
  const player = usePlayer()
  const [menuEntryId, setMenuEntryId] = useState<number | null>(null)
  const entries = player.queueState.nowPlayingEntries
  const currentIndex = player.queueState.currentIndex
  const history = player.queueState.historyEntries ?? []
  const current = entries[currentIndex]
  const upcoming = entries.slice(currentIndex + 1)
  const menuEntry = upcoming.find((entry) => entry.queueId === menuEntryId)

  return (
    <aside className="player-queue" aria-label="Playback queue">
      <div className="player-queue__heading">
        <div><p className="player-eyebrow">Queue</p><h2>{player.queueState.contextLabel || 'Listening session'}</h2></div>
        <span>{entries.length} items</span>
      </div>
      <div className="player-queue__scroll" tabIndex={0} aria-label="Scrollable playback queue">
        {history.length > 0 && <QueueSection title="History" count={history.length}>
          {history.map((entry, index) => <QueueRow key={`history-${entry.queueId}`} entry={entry} tone="history" position={index + 1} primaryLabel={`Replay ${entry.item.title}`} onPrimary={() => player.queue.rewindTo(index)} />)}
        </QueueSection>}
        {current && <QueueSection title="Now playing" count={1}>
          <QueueRow entry={current} tone="current" position={currentIndex + 1} />
        </QueueSection>}
        <QueueSection title="Up next" count={upcoming.length}>
          {upcoming.length === 0
            ? <p className="player-muted">The queue is empty.</p>
            : upcoming.map((entry, offset) => {
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
              />
            })}
        </QueueSection>
      </div>
      {menuEntry && <div className="player-queue__menu" role="menu" aria-label={`${menuEntry.item.title} queue actions`}>
        <strong>{menuEntry.item.title}</strong>
        {!player.isQueueEntryEligible(menuEntry.queueId) && <button type="button" role="menuitem" onClick={() => { player.queue.unskipEntry(menuEntry.queueId); setMenuEntryId(null) }}>Play this disliked item</button>}
        <button type="button" role="menuitem" onClick={() => { player.queue.moveToPlayNext(menuEntry.queueId); setMenuEntryId(null) }}>Play next</button>
        <button type="button" role="menuitem" onClick={() => { player.queue.addToQueue([menuEntry.item]); setMenuEntryId(null) }}>Add another to queue</button>
        <button type="button" role="menuitem" className="player-queue__danger" onClick={() => { player.queue.removeEntry(menuEntry.queueId); setMenuEntryId(null) }}><Trash2 size={15} /> Remove from queue</button>
        <button type="button" onClick={() => setMenuEntryId(null)}>Close</button>
      </div>}
    </aside>
  )
}

function QueueSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return <div className="player-queue__section">
    <div className="player-queue__section-heading"><h3 id={`queue-${title.toLowerCase().replace(/\s+/g, '-')}`}>{title}</h3><span>{count}</span></div>
    <ol>{children}</ol>
  </div>
}

function QueueRow({ entry, tone, position, primaryLabel, onPrimary, onMoveUp, onMoveDown, onMore, menuOpen = false }: {
  entry: QueueEntry
  tone: 'history' | 'current' | 'upcoming'
  position: number
  primaryLabel?: string
  onPrimary?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onMore?: () => void
  menuOpen?: boolean
}) {
  const copy = <><span className="player-queue__index">{position}</span><span className="player-queue__copy"><strong>{entry.item.title}</strong><small>{entry.item.artist ?? entry.item.album ?? 'Anime Ongaku'}</small></span><time>{formatTime((entry.item.durationMs ?? 0) / 1000)}</time></>
  return <li className={`player-queue__row player-queue__row--${tone}`}>
    {onPrimary ? <button type="button" className="player-queue__primary" onClick={onPrimary} aria-label={primaryLabel}>{copy}</button> : <div className="player-queue__primary" aria-current="true">{copy}</div>}
    {tone === 'upcoming' && <div className="player-queue__row-actions">
      <button type="button" onClick={onMoveUp} disabled={!onMoveUp} aria-label={`Move ${entry.item.title} up`}><ChevronUp size={15} /></button>
      <button type="button" onClick={onMoveDown} disabled={!onMoveDown} aria-label={`Move ${entry.item.title} down`}><ChevronDown size={15} /></button>
      <button type="button" onClick={onMore} aria-label={`More actions for ${entry.item.title} in queue`} aria-haspopup="menu" aria-expanded={menuOpen}><Ellipsis size={17} /></button>
    </div>}
  </li>
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
