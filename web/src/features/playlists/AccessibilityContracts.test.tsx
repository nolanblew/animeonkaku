import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlaylistManager } from './components'

function renderManager() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlaylistManager
          playlists={[]}
          state="ready"
          onCreate={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('playlist dialog keyboard behavior', () => {
  it('focuses the first choice, traps Tab, and restores focus after Escape', async () => {
    const user = userEvent.setup()
    renderManager()

    const opener = screen.getByRole('button', { name: /new playlist/i })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: /create playlist/i })
    const manual = within(dialog).getByRole('button', { name: /manual playlist/i })
    const buttons = within(dialog).getAllByRole('button')
    const last = buttons[buttons.length - 1]

    expect(manual).toHaveFocus()
    last?.focus()
    await user.tab()
    expect(manual).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /create playlist/i })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
