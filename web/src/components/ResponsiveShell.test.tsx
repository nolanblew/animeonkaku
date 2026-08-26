import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ResponsiveShell } from './ResponsiveShell'
import { PlayerProvider } from '../player'

describe('ResponsiveShell', () => {
  it('provides a mobile navigation toggle while retaining keyboard-accessible labels', () => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <PlayerProvider><ResponsiveShell><h1>Library content</h1></ResponsiveShell></PlayerProvider>
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /library/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: /library content/i })).toBeInTheDocument()
  })
})
