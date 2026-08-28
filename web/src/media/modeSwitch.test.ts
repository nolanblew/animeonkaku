import { describe, expect, it } from 'vitest'
import { modeStartTime, shouldPreservePosition } from './modeSwitch'

describe('playback mode switching', () => {
  it('preserves position only between TV-size audio and its video', () => {
    expect(shouldPreservePosition('TV_SIZE', 'VIDEO')).toBe(true)
    expect(shouldPreservePosition('VIDEO', 'TV_SIZE')).toBe(true)
    expect(shouldPreservePosition('VIDEO', 'FULL_SIZE')).toBe(false)
    expect(shouldPreservePosition('FULL_SIZE', 'VIDEO')).toBe(false)
    expect(shouldPreservePosition('TV_SIZE', 'FULL_SIZE')).toBe(false)
  })

  it('clamps a preserved position to the target duration and restarts other switches', () => {
    expect(modeStartTime('TV_SIZE', 'VIDEO', 42, 90)).toBe(42)
    expect(modeStartTime('VIDEO', 'TV_SIZE', 92, 90)).toBe(89.75)
    expect(modeStartTime('VIDEO', 'FULL_SIZE', 42, 240)).toBe(0)
    expect(modeStartTime('TV_SIZE', 'TV_SIZE', 42, 90)).toBe(42)
  })

  it('never returns an invalid or negative media position', () => {
    expect(modeStartTime('TV_SIZE', 'VIDEO', -5, 0)).toBe(0)
    expect(modeStartTime('TV_SIZE', 'VIDEO', Number.NaN, Number.NaN)).toBe(0)
  })
})
