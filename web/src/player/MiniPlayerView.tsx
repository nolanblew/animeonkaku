import { Heart, ListMusic, Maximize, MoreHorizontal, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { usePlayer } from './PlayerProvider'

export interface MiniPlayerViewProps {
  className?: string
  onOpen?: () => void
}

export function MiniPlayerView({ className = '', onOpen }: MiniPlayerViewProps) {
  const player = usePlayer()
  const [liked, setLiked] = useState(false)
  const [volume, setVolume] = useState(100)
  const current = player.currentItem
  if (!current) {
    return <section className={['player-mini-player', 'player-mini-player--empty', className].filter(Boolean).join(' ')} aria-label="Mini player" data-testid="mini-player-view"><span className="player-mini-player__empty">Nothing playing</span></section>
  }
  const changeVolume = (value: number) => {
    const bounded = Math.max(0, Math.min(100, value))
    setVolume(bounded)
    if (player.audioElement) player.audioElement.volume = bounded / 100
    if (player.videoElement) player.videoElement.volume = bounded / 100
  }
  return (
    <section className={['player-mini-player', className].filter(Boolean).join(' ')} aria-label="Mini player" data-testid="mini-player-view">
      <div className="player-mini-player__identity">
        <button className="player-mini-player__track" type="button" onClick={onOpen} disabled={!onOpen} aria-label={`Open now playing for ${current.title}`}>
          {current.artworkUrl ? <img src={current.artworkUrl} alt="" /> : <span className="player-mini-player__artwork" aria-hidden="true">AO</span>}
          <span className="player-mini-player__meta"><strong>{current.title}</strong><small>{current.artist ?? current.album ?? 'Anime Ongaku'}</small></span>
        </button>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label={liked ? 'Unlike track' : 'Like track'} aria-pressed={liked} onClick={() => setLiked((value) => !value)}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></button>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label="More playback actions"><MoreHorizontal size={19} /></button>
      </div>
      <div className="player-mini-player__transport">
        <div className="player-mini-player__controls">
          <button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.toggleShuffle()} aria-label={player.queueState.isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={player.queueState.isShuffled}><Shuffle size={16} /></button>
          <button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => void player.previous()} aria-label="Previous track"><SkipBack size={18} fill="currentColor" /></button>
          <button type="button" className="player-play-button player-play-button--small" onClick={() => void player.togglePlay()} aria-label={player.isPlaying ? 'Pause current track' : 'Play current track'}>{player.isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
          <button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => void player.next()} aria-label="Next track"><SkipForward size={18} fill="currentColor" /></button>
          <button type="button" className="player-icon-button player-icon-button--quiet" onClick={() => player.cycleRepeat()} aria-label={`Repeat ${player.queueState.repeatMode}`} aria-pressed={player.queueState.repeatMode !== 'off'}><Repeat2 size={16} /></button>
        </div>
        <label className="player-mini-player__progress"><span>{formatTime(player.currentTime)}</span><input type="range" min="0" max={Math.max(0, player.duration)} step="0.1" value={Math.min(player.currentTime, Math.max(0, player.duration))} onChange={(event) => player.seek(Number(event.currentTarget.value))} aria-label="Seek mini player" /><span>{formatTime(player.duration)}</span><span className="sr-only">{formatTime(player.currentTime)} / {formatTime(player.duration)}</span></label>
      </div>
      <div className="player-mini-player__utilities">
        <Volume2 size={18} aria-hidden="true" />
        <input type="range" min="0" max="100" value={volume} onChange={(event) => changeVolume(Number(event.currentTarget.value))} aria-label="Volume" />
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label="Open queue" onClick={onOpen}><ListMusic size={18} /></button>
        <button type="button" className="player-icon-button player-icon-button--quiet" aria-label="Open fullscreen player" onClick={onOpen}><Maximize size={18} /></button>
      </div>
    </section>
  )
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00'
  const seconds = Math.floor(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
