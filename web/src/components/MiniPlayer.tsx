import {
  Heart,
  ListMusic,
  Maximize2,
  Pause,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function MiniPlayer() {
  const navigate = useNavigate()

  return (
    <section className="mini-player" aria-label="Mini player" data-testid="mini-player">
      <button className="mini-player__track" type="button" onClick={() => navigate('/now-playing')}>
        <span className="artwork artwork--sm" aria-hidden="true">AO</span>
        <span className="mini-player__meta">
          <strong>Yano-kun no Futsuu no Hibi · OP</strong>
          <span>POP LIFE · FANTASTICS</span>
        </span>
      </button>

      <div className="mini-player__controls" aria-label="Playback controls">
        <button className="icon-button icon-button--quiet hide-compact" type="button" aria-label="Shuffle">
          <Shuffle size={17} />
        </button>
        <button className="icon-button icon-button--quiet" type="button" aria-label="Previous track">
          <SkipBack size={18} fill="currentColor" />
        </button>
        <button className="play-button play-button--small" type="button" aria-label="Pause current track">
          <Pause size={18} fill="currentColor" />
        </button>
        <button className="icon-button icon-button--quiet" type="button" aria-label="Next track">
          <SkipForward size={18} fill="currentColor" />
        </button>
        <button className="icon-button icon-button--quiet hide-compact" type="button" aria-label="Repeat">
          <Repeat2 size={17} />
        </button>
      </div>

      <div className="mini-player__progress">
        <span>1:28</span>
        <input type="range" min="0" max="100" value="42" readOnly aria-label="Track progress" />
        <span>3:45</span>
      </div>

      <div className="mini-player__actions">
        <button className="icon-button icon-button--quiet hide-narrow" type="button" aria-label="Like track">
          <Heart size={18} />
        </button>
        <button className="icon-button icon-button--quiet hide-narrow" type="button" aria-label="Volume">
          <Volume2 size={18} />
        </button>
        <button className="icon-button icon-button--quiet hide-narrow" type="button" aria-label="Open queue">
          <ListMusic size={19} />
        </button>
        <button className="icon-button icon-button--quiet" type="button" aria-label="Open now playing" onClick={() => navigate('/now-playing')}>
          <Maximize2 size={18} />
        </button>
      </div>
    </section>
  )
}
