import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './ErrorBoundary'

function BrokenRoute(): ReactElement {
  throw new Error('token=private-value')
}

describe('AppErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('converts render failures into the safe server error surface', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<MemoryRouter><AppErrorBoundary><BrokenRoute /></AppErrorBoundary></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    expect(screen.queryByText(/private-value/i)).not.toBeInTheDocument()
  })
})
