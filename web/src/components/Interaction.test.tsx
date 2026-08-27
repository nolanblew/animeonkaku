import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ErrorState, sanitizeErrorDetails } from './ErrorState'
import { MiniPlayer } from './MiniPlayer'
import { ResponsiveShell } from './ResponsiveShell'
import { PlayerProvider } from '../player'

describe('interaction and safe error surfaces', () => {
  it('redacts credentials and infrastructure details before showing diagnostics', () => {
    expect(sanitizeErrorDetails(new Error('token=abc password=hunter2 postgres://admin:secret@db'))).toBe('token: [redacted] password: [redacted] postgres://[redacted]')
  })

  it('redacts quoted JSON secret fields without exposing their values', () => {
    const sanitized = sanitizeErrorDetails('{"password":"hunter2","accessToken":"access-value","client_secret":"client-value","note":"safe"}')
    expect(sanitized).toContain('"password":"[redacted]"')
    expect(sanitized).toContain('"accessToken":"[redacted]"')
    expect(sanitized).toContain('"client_secret":"[redacted]"')
    expect(sanitized).toContain('"note":"safe"')
    expect(sanitized).not.toMatch(/hunter2|access-value|client-value/)
  })

  it('redacts Bearer credentials', () => {
    const sanitized = sanitizeErrorDetails('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret-signature')
    expect(sanitized).toContain('Bearer [redacted]')
    expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret-signature')
  })

  it('redacts sensitive URL query parameters', () => {
    const sanitized = sanitizeErrorDetails('https://example.test/callback?access_token=access-value&api_key=api-value&state=keep-this')
    expect(sanitized).not.toMatch(/access-value|api-value/)
    expect(sanitized).toContain('state=keep-this')
  })

  it('shows a server retry action and expandable safe details', () => {
    const reload = vi.fn()
    render(<MemoryRouter><ErrorState details={new Error('secret=hidden')} onRetry={reload} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /show technical details/i }))
    expect(screen.getByLabelText(/technical details/i)).not.toHaveTextContent('hidden')
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reload).toHaveBeenCalled()
  })

  it('supports mobile navigation, profile menu, and global search submission', () => {
    render(<MemoryRouter initialEntries={['/']}><PlayerProvider><ResponsiveShell><h1>Home content</h1></ResponsiveShell></PlayerProvider></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))
    expect(screen.getAllByRole('button', { name: /close navigation/i })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /anime fan.*connected/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /account settings/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /search songs/i }), { target: { value: 'bleach' } })
    fireEvent.submit(screen.getByRole('search', { name: /global search/i }))
    expect(screen.getByRole('heading', { name: /home content/i })).toBeInTheDocument()
  })

  it('anchors the compact top-bar profile menu beside the button that opened it', () => {
    render(<MemoryRouter initialEntries={['/']}><PlayerProvider><ResponsiveShell><h1>Home content</h1></ResponsiveShell></PlayerProvider></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }))

    const menu = screen.getByRole('menu')
    expect(menu).toHaveClass('topbar__profile-menu')
    expect(menu.closest('.topbar__actions')).not.toBeNull()
  })

  it('opens now playing from the mini-player track', () => {
    render(<MemoryRouter initialEntries={['/']}><MiniPlayer /></MemoryRouter>)
    expect(screen.getByRole('region', { name: /mini player/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /yano-kun/i }))
    fireEvent.click(screen.getByRole('button', { name: /open now playing/i }))
  })
})
