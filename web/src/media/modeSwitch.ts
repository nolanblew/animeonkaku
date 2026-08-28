export type PlaybackMode = 'TV_SIZE' | 'FULL_SIZE' | 'VIDEO'

export function shouldPreservePosition(from: PlaybackMode, to: PlaybackMode): boolean {
  if (from === to) return true
  return (from === 'TV_SIZE' && to === 'VIDEO') || (from === 'VIDEO' && to === 'TV_SIZE')
}

export function modeStartTime(
  from: PlaybackMode,
  to: PlaybackMode,
  currentTime: number,
  targetDuration?: number,
): number {
  if (!shouldPreservePosition(from, to) || !Number.isFinite(currentTime) || currentTime <= 0) return 0
  if (!Number.isFinite(targetDuration) || (targetDuration ?? 0) <= 0) return currentTime
  return Math.max(0, Math.min(currentTime, Math.max(0, targetDuration! - 0.25)))
}
