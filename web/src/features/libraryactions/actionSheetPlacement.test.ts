import { describe, expect, it } from 'vitest'
import actionCss from './libraryactions.css?raw'

describe('advanced action sheet placement', () => {
  it('centers the modal action surface within its scrim', () => {
    expect(actionCss).toMatch(/library-actions__scrim[^}]*display:\s*grid[^}]*place-items:\s*center/)
    expect(actionCss).toMatch(/\.library-actions\s*\{[^}]*position:\s*relative[^}]*right:\s*auto[^}]*bottom:\s*auto[^}]*left:\s*auto/)
  })
})
