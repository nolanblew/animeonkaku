import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ResponsiveShell } from './ResponsiveShell'
import { PlayerProvider } from '../player'
import '../styles.css'

describe('ResponsiveShell', () => {
  it('provides a mobile navigation toggle while retaining keyboard-accessible labels', () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <PlayerProvider><ResponsiveShell><h1>Library content</h1></ResponsiveShell></PlayerProvider>
      </MemoryRouter>,
    )

    const openNavigation = screen.getByLabelText(/open navigation/i, { selector: 'button' })
    expect(openNavigation).toBeInTheDocument()
    expect(getComputedStyle(openNavigation).display).toBe('none')
    for (const closeButton of screen.getAllByLabelText(/close navigation/i, { selector: 'button' })) {
      expect(getComputedStyle(closeButton).display).toBe('none')
    }
    expect(screen.getByRole('link', { name: /library/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: /library content/i })).toBeInTheDocument()
  })
})
