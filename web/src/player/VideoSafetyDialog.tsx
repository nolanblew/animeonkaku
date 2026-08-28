import { useAccessibleFocusScope } from '../components/focusScope'
import { useRef } from 'react'

export interface VideoSafetyDialogProps {
  title: string
  spoiler: boolean
  nsfw: boolean
  onCancel: () => void
  onContinue: () => void
}

/** A single shared confirmation surface used regardless of which player view initiated video playback. */
export function VideoSafetyDialog({ title, spoiler, nsfw, onCancel, onContinue }: VideoSafetyDialogProps) {
  const warnings = [
    spoiler ? 'It may contain spoilers.' : null,
    nsfw ? 'It may contain content that is not safe for work.' : null,
  ].filter((warning): warning is string => Boolean(warning))
  const continueRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useAccessibleFocusScope<HTMLElement>({ onEscape: onCancel, initialFocusRef: continueRef })

  return (
    <div className="player-video-warning__scrim">
      <section ref={dialogRef} className="player-video-warning" role="dialog" aria-modal="true" aria-labelledby="player-video-warning-title">
        <p className="player-eyebrow">Before you continue</p>
        <h2 id="player-video-warning-title">Video content warning</h2>
        <p>This video for <strong>{title}</strong> has been marked with the following warning{warnings.length === 1 ? '' : 's'}:</p>
        <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <p className="player-video-warning__note">Only continue if you are comfortable viewing this material.</p>
        <div className="player-video-warning__actions">
          <button type="button" className="player-mode-button" onClick={onCancel}>Cancel video</button>
          <button ref={continueRef} type="button" className="player-play-button player-play-button--small" autoFocus onClick={onContinue}>Continue to video</button>
        </div>
      </section>
    </div>
  )
}
