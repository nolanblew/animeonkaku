import { describe, expect, it } from 'vitest'
import playerCss from './player.css?raw'
import shellCss from '../styles.css?raw'

describe('expanded player viewport contract', () => {
  it('locks the route to the dynamic viewport and clips the queue instead of nesting scrollbars', () => {
    expect(shellCss).toMatch(/content-frame--player[^}]*height:\s*100dvh/)
    expect(shellCss).toMatch(/main-content--player[^}]*overflow:\s*hidden/)
    expect(playerCss).toMatch(/player-now-playing[^}]*height:\s*100%/)
    expect(playerCss).toMatch(/player-queue[^}]*overflow:\s*hidden/)
    expect(playerCss).not.toMatch(/player-queue[^}]*overflow:\s*auto/)
  })
})
