import { Maximize, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { usePlayer } from './PlayerProvider'
import type { PlaybackMode } from '../media/modeSwitch'

export interface NowPlayingViewProps {
  className?: string
}

export function NowPlayingView({ className = '' }: NowPlayingViewProps) {
  const player = usePlayer()
  const current = player.currentItem
  const title = current?.title ?? 'Nothing playing'
  const artist = current?.artist ?? 'Choose a theme or song to begin.'
  const rootClass = ['player-now-playing', className].filter(Boolean).join(' ')
  const upcoming = player.queueState.nowPlayingEntries.slice(player.queueState.currentIndex + 1)

  return (
    <section className={rootClass} aria-label="Now playing" data-testid="now-playing-view">
      <div className="player-now-playing__stage">
        {player.mode !== 'VIDEO' && <div className="player-now-playing__artwork-wrap">
          {current?.artworkUrl ? <img className="player-now-playing__artwork" src={current.artworkUrl} alt="" /> : <div className="player-now-playing__artwork player-now-playing__artwork--fallback" aria-hidden="true">AO</div>}
        </div>}
        <div className="player-video-surface" ref={player.registerVideoSurface} data-testid="now-playing-video-surface" aria-label="Video surface" />
        <div className="player-now-playing__copy"><p className="player-eyebrow">Now playing</p><h2>{title}</h2><p>{artist}</p></div>
        <div className="player-now-playing__progress"><span aria-live="off">{formatTime(player.currentTime)}</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek" disabled={!current} /><span aria-live="off">{formatTime(player.duration)}</span></div>
        <div className="player-now-playing__controls" aria-label="Playback controls"><button type="button" className="player-icon-button" onClick={() => player.toggleShuffle()} aria-label={player.queueState.isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={player.queueState.isShuffled}><Shuffle size={18} aria-hidden="true" /></button><button type="button" className="player-icon-button" onClick={() => void player.previous()} aria-label="Previous track" disabled={!current}><SkipBack size={19} aria-hidden="true" /></button><button type="button" className="player-play-button" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'} disabled={!current}>{player.isPlaying ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" />}</button><button type="button" className="player-icon-button" onClick={() => void player.next()} aria-label="Next track" disabled={!current}><SkipForward size={19} aria-hidden="true" /></button><button type="button" className="player-icon-button" onClick={() => player.cycleRepeat()} aria-label={`Repeat ${player.queueState.repeatMode}`} aria-pressed={player.queueState.repeatMode !== 'off'}><Repeat size={18} aria-hidden="true" /></button></div>
        <div className="player-mode-controls" role="group" aria-label="Playback size"><ModeButton mode="TV_SIZE" label="TV size" disabled={!player.tvSizeAvailable} /><ModeButton mode="FULL_SIZE" label="Full size" disabled={!player.fullSizeAvailable} /><ModeButton mode="VIDEO" label="Video" disabled={!player.videoAvailable} />{player.mode === 'VIDEO' && <button type="button" className="player-icon-button" onClick={() => void player.requestFullscreen()} aria-label="Enter fullscreen"><Maximize size={18} aria-hidden="true" /></button>}</div>
        {player.error && <p className="player-error" role="alert">{player.error}</p>}
        {player.isLoading && <p className="player-loading" role="status">Loading media…</p>}
        {!player.videoAvailable && <p className="player-muted">Video unavailable for this theme.</p>}
      </div>
      <aside className="player-queue" aria-label="Up next"><div className="player-queue__heading"><p className="player-eyebrow">Queue</p><h2>Up next</h2><span>{upcoming.length}</span></div>{upcoming.length === 0 ? <p className="player-muted">The queue is empty.</p> : <ol>{upcoming.map((entry, offset) => <li key={entry.queueId}><button type="button" onClick={() => player.skipTo(player.queueState.currentIndex + offset + 1)} aria-label={`Play ${entry.item.title}`}><span className="player-queue__index">{offset + 1}</span><span><strong>{entry.item.title}</strong><small>{entry.item.artist ?? entry.item.album ?? 'Anime Ongaku'}</small></span><time>{formatTime((entry.item.durationMs ?? 0) / 1000)}</time></button></li>)}</ol>}</aside>
    </section>
  )

  function ModeButton({ mode, label, disabled = false }: { mode: PlaybackMode; label: string; disabled?: boolean }) {
    return <button type="button" className="player-mode-button" onClick={() => player.setMode(mode)} aria-pressed={player.mode === mode} disabled={disabled}>{label}</button>
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
