import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { usePlayer } from './PlayerProvider'

export interface MiniPlayerViewProps {
  className?: string
}

export function MiniPlayerView({ className = '' }: MiniPlayerViewProps) {
  const player = usePlayer()
  const current = player.currentItem
  if (!current) {
    return <section className={['player-mini-player', className].filter(Boolean).join(' ')} aria-label="Mini player" data-testid="mini-player-view"><span className="player-mini-player__empty">Nothing playing</span></section>
  }
  return (
    <section className={['player-mini-player', className].filter(Boolean).join(' ')} aria-label="Mini player" data-testid="mini-player-view">
      <div className="player-mini-player__track">
        {current.artworkUrl ? <img src={current.artworkUrl} alt="" /> : <span className="player-mini-player__artwork" aria-hidden="true">AO</span>}
        <span className="player-mini-player__meta"><strong>{current.title}</strong><small>{current.artist ?? 'Anime Ongaku'}</small></span>
      </div>
      <div className="player-mini-player__controls">
        <button type="button" className="player-icon-button" onClick={() => void player.previous()} aria-label="Previous track"><SkipBack size={16} aria-hidden="true" /></button>
        <button type="button" className="player-play-button player-play-button--small" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'}>{player.isPlaying ? <Pause size={17} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}</button>
        <button type="button" className="player-icon-button" onClick={() => void player.next()} aria-label="Next track"><SkipForward size={16} aria-hidden="true" /></button>
      </div>
      <label className="player-mini-player__progress"><span className="sr-only">Seek</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek mini player" /><span>{formatTime(player.currentTime)} / {formatTime(player.duration)}</span></label>
    </section>
  )
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

