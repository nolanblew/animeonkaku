import { ChevronDown, Heart, Maximize, MoreHorizontal, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { usePlayer } from './PlayerProvider'
import type { PlaybackMode } from '../media/modeSwitch'

export interface NowPlayingViewProps { className?: string; onCollapse?: () => void }

export function NowPlayingView({ className = '', onCollapse }: NowPlayingViewProps) {
  const player = usePlayer()
  const [liked, setLiked] = useState(false)
  const current = player.currentItem
  const title = current?.title ?? 'Nothing playing'
  const artist = current?.artist ?? 'Choose a theme or song to begin.'
  const upcoming = player.queueState.nowPlayingEntries.slice(player.queueState.currentIndex + 1)
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
          <div className="player-now-playing__secondary-actions"><button type="button" className="player-icon-button player-icon-button--quiet" aria-label={liked ? 'Unlike track' : 'Like track'} aria-pressed={liked} onClick={() => setLiked((value) => !value)}><Heart size={20} fill={liked ? 'currentColor' : 'none'} /></button><button type="button" className="player-icon-button player-icon-button--quiet" aria-label="More playback actions"><MoreHorizontal size={21} /></button></div>
          <div className="player-now-playing__progress"><span aria-live="off">{formatTime(player.currentTime)}</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek" disabled={!current} /><span aria-live="off">{formatTime(player.duration)}</span></div>
          <div className="player-now-playing__controls" aria-label="Playback controls"><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.toggleShuffle()} aria-label={player.queueState.isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={player.queueState.isShuffled}><Shuffle size={20} /></button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.previous()} aria-label="Previous track" disabled={!current}><SkipBack size={24} fill="currentColor" /></button><button type="button" className="player-play-button player-play-button--hero" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'} disabled={!current}>{player.isPlaying ? <Pause size={29} fill="currentColor" /> : <Play size={29} fill="currentColor" />}</button><button type="button" className="player-icon-button player-icon-button--quiet player-skip-button" onClick={() => void player.next()} aria-label="Next track" disabled={!current}><SkipForward size={24} fill="currentColor" /></button><button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.cycleRepeat()} aria-label={`Repeat ${player.queueState.repeatMode}`} aria-pressed={player.queueState.repeatMode !== 'off'}><Repeat size={20} /></button></div>
          <div className="player-mode-controls" role="group" aria-label="Playback size"><ModeButton mode="TV_SIZE" label="TV size" disabled={!player.tvSizeAvailable} /><ModeButton mode="FULL_SIZE" label="Full size" disabled={!player.fullSizeAvailable} /><ModeButton mode="VIDEO" label="Video" disabled={!player.videoAvailable} />{isVideo && <button type="button" className="player-icon-button" onClick={() => void player.requestFullscreen()} aria-label="Enter fullscreen"><Maximize size={18} /></button>}</div>
          {player.error && <p className="player-error" role="alert">{player.error}</p>}
          {player.isLoading && <p className="player-loading" role="status">Loading media…</p>}
          {!player.videoAvailable && <p className="player-muted">Video unavailable for this theme.</p>}
        </div>

        <aside className="player-queue" aria-label="Up next"><div className="player-queue__heading"><p className="player-eyebrow">Queue</p><h2>Up next</h2><span>{upcoming.length}</span></div>{upcoming.length === 0 ? <p className="player-muted">The queue is empty.</p> : <ol>{upcoming.map((entry, offset) => <li key={entry.queueId}><button type="button" onClick={() => player.skipTo(player.queueState.currentIndex + offset + 1)} aria-label={`Play ${entry.item.title}`}><span className="player-queue__index">{offset + 1}</span><span><strong>{entry.item.title}</strong><small>{entry.item.artist ?? entry.item.album ?? 'Anime Ongaku'}</small></span><time>{formatTime((entry.item.durationMs ?? 0) / 1000)}</time></button></li>)}</ol>}</aside>
      </div>
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
