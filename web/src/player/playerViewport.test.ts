import { describe, expect, it } from 'vitest'
import playerCss from './player.css?raw'
import shellCss from '../styles.css?raw'

describe('expanded player viewport contract', () => {
  it('locks the route to the dynamic viewport and gives the queue one bounded internal scroller', () => {
    expect(shellCss).toMatch(/content-frame--player[^}]*height:\s*100dvh/)
    expect(shellCss).toMatch(/main-content--player[^}]*overflow:\s*hidden/)
    expect(playerCss).toMatch(/player-now-playing[^}]*height:\s*100%/)
    expect(playerCss).toMatch(/player-queue__scroll[^}]*overflow-y:\s*auto/)
    expect(playerCss).not.toMatch(/player-queue li:nth-child/)
    expect(playerCss).toMatch(/player-now-playing--queue-open[^}]*grid-template-columns:\s*minmax\([^;]+minmax\(/)
    expect(playerCss).toMatch(/player-queue[^}]*position:\s*relative/)
    expect(playerCss).toMatch(/@media \(max-width:\s*1180px\)[\s\S]*player-now-playing--queue-open[^}]*grid-template-rows:\s*auto minmax\(0,1fr\) minmax\(14rem,40vh\)/)
    expect(playerCss).toMatch(/@media \(max-width:\s*1180px\)[\s\S]*player-queue[^}]*grid-row:\s*3/)
  })
})
