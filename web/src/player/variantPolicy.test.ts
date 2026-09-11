import { describe, expect, it } from 'vitest'
import { resolveQueueItemMode, isQueueEntryAllowedByPreference, type QueuePreferenceSnapshot } from './preferenceQueue'
import { type PlayerQueueItem, queueItemAudioUrl } from './mapping'

const track: PlayerQueueItem = { id: 1, themeId: 1, itemType: 'THEME', title: 'Song', mode: 'TV_SIZE', tvAudioUrl: '/tv', fullAudioUrl: '/full' }
const prefs = (preference: QueuePreferenceSnapshot['themesById'][string]): QueuePreferenceSnapshot => ({ themesById: { 1: preference }, songsById: {} })

describe('theme version policy', () => {
  it.each(['TV_SIZE', 'FULL_SIZE'] as const)('replaces disliked %s without requesting it', mode => {
    const snapshot = prefs(mode === 'TV_SIZE' ? { dislikedTvSize: true } : { dislikedFullSize: true })
    const selected = resolveQueueItemMode({ ...track, mode }, snapshot, mode)
    expect(selected).toBe(mode === 'TV_SIZE' ? 'FULL_SIZE' : 'TV_SIZE')
    expect(isQueueEntryAllowedByPreference({ queueId: 7, item: { ...track, mode } }, snapshot)).toBe(true)
    expect(resolveQueueItemMode({ ...track, [mode === 'TV_SIZE' ? 'fullAudioUrl' : 'tvAudioUrl']: undefined }, snapshot, mode)).toBeNull()
  })
  it('prefers saved size, falls back when absent, and preserves the stored preference', () => {
    const snapshot = prefs({ preferredMode: 'FULL_SIZE' })
    expect(resolveQueueItemMode(track, snapshot, 'TV_SIZE')).toBe('FULL_SIZE')
    expect(resolveQueueItemMode({ ...track, fullAudioUrl: undefined }, snapshot, 'TV_SIZE')).toBe('TV_SIZE')
    expect(snapshot.themesById[1]?.preferredMode).toBe('FULL_SIZE')
  })
  it('required version skips unavailable, conflicting and disliked tracks even after unskip', () => {
    const required = { ...track, requiredMode: 'TV_SIZE' as const }
    for (const preference of [{ preferredMode: 'FULL_SIZE' as const }, { dislikedTvSize: true }, { disliked: true }]) {
      expect(isQueueEntryAllowedByPreference({ queueId: 7, item: required }, prefs(preference))).toBe(false)
    }
    expect(resolveQueueItemMode({ ...required, tvAudioUrl: undefined }, prefs({}), 'FULL_SIZE')).toBeNull()
    expect(isQueueEntryAllowedByPreference({ queueId: 7, item: required }, prefs({ dislikedTvSize: true }), new Set([7]))).toBe(false)
  })
  it('never treats full audio as TV audio', () => {
    expect(queueItemAudioUrl({ ...track, tvAudioUrl: undefined, audioUrl: '/full' }, 'TV_SIZE')).toBeUndefined()
  })
})
