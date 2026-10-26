export function nextTrack(items, currentId, repeatMode) {
  const index = items.findIndex(item => item.itemId === currentId);
  if (index < 0) return null;
  if (repeatMode === 'REPEAT_SINGLE') return items[index];
  return items[index + 1] ?? (repeatMode === 'REPEAT_ALL' ? items[0] : null);
}

export function playbackView(position, duration, state, next) {
  const known = Number.isFinite(duration) && duration > 0;
  const elapsed = Number.isFinite(position) ? Math.max(0, position) : 0;
  const remaining = known ? Math.max(0, duration - elapsed) : 0;
  return {
    progress: known ? Math.min(1, elapsed / duration) : 0,
    remaining,
    showNext: Boolean(next) && known && remaining > 0 && remaining <= 10 && state !== 'IDLE',
    animate: state === 'PLAYING',
  };
}

export function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
