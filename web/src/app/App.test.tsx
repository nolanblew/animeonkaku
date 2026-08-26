import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('web player app shell', () => {
  it('renders the accessible shell regions and navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument())
    expect(screen.getByRole('search', { name: /global search/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /mini player/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('aria-current', 'page')
  })

  it('renders a login page outside the player shell', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument()
  })

  it.each([
    ['/library', /library/i],
    ['/search?q=bleach', /search/i],
    ['/anime/16bit-sensation', /anime · 16bit-sensation/i],
    ['/playlist/currently-watching', /currently watching/i],
    ['/now-playing', /pop life/i],
    ['/settings', /settings/i],
  ])('loads the lazy route at %s', async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument())
  })

  it('renders sanitized not-found details with safe expandable details', async () => {
    render(
      <MemoryRouter initialEntries={['/does-not-exist']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument())
    const detailsButton = screen.getByRole('button', { name: /show technical details/i })
    expect(detailsButton).toBeInTheDocument()
    fireEvent.click(detailsButton)
    expect(screen.getByLabelText(/technical details/i)).toHaveTextContent('No route matched')
    expect(screen.getByLabelText(/technical details/i)).not.toHaveTextContent(/stack|postgres|token|password/i)
  })

  it('renders the 500 route with a retry action and expandable details', async () => {
    render(
      <MemoryRouter initialEntries={['/error']}>
        <App />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show technical details/i })).toBeInTheDocument()
  })
})
