import { describe, expect, it, vi } from 'vitest'
import { runPlayerViewTransition } from './viewTransition'

describe('player view transition', () => {
  it('uses the browser view-transition API for expanding and collapsing', () => {
    const update = vi.fn()
    const startViewTransition = vi.fn((callback: () => void) => { callback(); return {} })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition })

    runPlayerViewTransition(update)

    expect(startViewTransition).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
  })

  it('falls back to an immediate navigation when the API is unavailable', () => {
    const update = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined })

    runPlayerViewTransition(update)

    expect(update).toHaveBeenCalledOnce()
  })
})
