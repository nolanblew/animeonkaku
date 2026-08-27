import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import type { ReactElement } from 'react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from './ErrorBoundary'

function BrokenRoute(): ReactElement {
  throw new Error('token=private-value')
}

function RouteContent(): ReactElement {
  const location = useLocation()
  if (location.pathname === '/broken') throw new Error('route failed')
  return <h1>Recovered route</h1>
}

function RouteDriver(): ReactElement {
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/healthy')}>Change route</button>
      <AppErrorBoundary><RouteContent /></AppErrorBoundary>
    </>
  )
}

function StatefulRoute(): ReactElement {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  return <><button type="button" onClick={() => setCount((value) => value + 1)}>Count {count}</button><button type="button" onClick={() => navigate('/next')}>Next route</button></>
}

describe('AppErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('converts render failures into the safe server error surface', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<MemoryRouter><AppErrorBoundary><BrokenRoute /></AppErrorBoundary></MemoryRouter>)
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    expect(screen.queryByText(/private-value/i)).not.toBeInTheDocument()
  })

  it('recovers when Go home navigates away from the failed route', async () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <AppErrorBoundary><RouteContent /></AppErrorBoundary>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /go home/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /recovered route/i })).toBeInTheDocument())
  })

  it('recovers when the current route changes outside the boundary', async () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <RouteDriver />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /change route/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /recovered route/i })).toBeInTheDocument())
  })

  it('does not remount healthy stateful children during ordinary navigation', async () => {
    render(<MemoryRouter initialEntries={['/start']}><AppErrorBoundary><StatefulRoute /></AppErrorBoundary></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Count 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next route' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument())
  })
})
