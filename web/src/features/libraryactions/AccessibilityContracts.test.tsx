import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeActionSheet } from './ThemeActionSheet'
import { TrackActionMenu } from './TrackActionMenu'

function ThemeActionSheetHarness() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open theme actions</button>
      {open && (
        <ThemeActionSheet
          themeId={41}
          title="Opening theme"
          subtitle="Anime · OP1"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

describe('shared track menus', () => {
  it('moves focus into the menu and supports roving keyboard navigation', async () => {
    const user = userEvent.setup()
    render(
      <TrackActionMenu
        item={{ itemType: 'THEME', itemId: 41, title: 'Opening theme' }}
        onPlayNext={vi.fn()}
        onAddToQueue={vi.fn()}
        onReplaceQueue={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'More actions for Opening theme' }))
    const menu = screen.getByRole('menu', { name: 'Opening theme actions' })
    const playNext = within(menu).getByRole('menuitem', { name: 'Play next' })
    const addToQueue = within(menu).getByRole('menuitem', { name: 'Add to queue' })
    const replaceQueue = within(menu).getByRole('menuitem', { name: 'Replace queue' })

    expect(playNext).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(addToQueue).toHaveFocus()
    await user.keyboard('{End}')
    expect(replaceQueue).toHaveFocus()
    await user.keyboard('{Home}')
    expect(playNext).toHaveFocus()
  })

  it('closes on Escape and restores focus to the menu trigger', async () => {
    const user = userEvent.setup()
    render(<TrackActionMenu item={{ itemType: 'SONG', itemId: 91, title: 'Full song' }} />)

    const trigger = screen.getByRole('button', { name: 'More actions for Full song' })
    await user.click(trigger)
    expect(screen.getByRole('menu', { name: 'Full song actions' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu', { name: 'Full song actions' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('theme action sheet dialog behavior', () => {
  it('focuses the first action, traps Tab, and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<ThemeActionSheetHarness />)

    const opener = screen.getByRole('button', { name: 'Open theme actions' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Opening theme actions' })
    const firstAction = within(dialog).getByRole('button', { name: 'Play now' })
    const buttons = within(dialog).getAllByRole('button')
    const lastAction = buttons[buttons.length - 1]

    expect(firstAction).toHaveFocus()
    lastAction?.focus()
    await user.tab()
    expect(firstAction).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Opening theme actions' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('dismisses when the scrim is clicked without treating the dialog as the scrim', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { container } = render(
      <ThemeActionSheet
        themeId={41}
        title="Opening theme"
        subtitle="Anime · OP1"
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Opening theme actions' })
    await user.click(dialog)
    expect(onClose).not.toHaveBeenCalled()

    const scrim = container.querySelector('.library-actions__scrim')
    expect(scrim).not.toBeNull()
    await user.click(scrim as HTMLElement)
    expect(onClose).toHaveBeenCalledOnce()
  })
})
