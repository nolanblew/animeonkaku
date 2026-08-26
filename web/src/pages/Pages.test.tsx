import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AnimePage, HomePage, LibraryPage, NowPlayingPage, PlaylistPage, SearchPage, ServerErrorPage, SettingsPage } from './Pages'

function renderRoute(element: React.ReactElement, path = '/', routePath = '*') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={element} /></Routes></MemoryRouter>)
}

describe('intentional route surfaces', () => {
  it.each([
    ['library', LibraryPage, 'Library'],
    ['settings', SettingsPage, 'Settings'],
    ['error', ServerErrorPage, 'We’re tuning the signal'],
  ])('renders the %s route skeleton', async (_route, Page, heading) => {
    renderRoute(<Page />)
    await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument())
    expect(screen.getByText(/ready for server-backed content/i)).toBeInTheDocument()
  })

  it('renders home and search previews with a query', async () => {
    renderRoute(<HomePage />)
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play akebi/i })).toBeInTheDocument()

    renderRoute(<SearchPage />, '/search?q=naruto')
    await waitFor(() => expect(screen.getByRole('heading', { name: /search for “naruto”/i })).toBeInTheDocument())
  })

  it('keeps route identifiers visible while detailing anime and playlist skeletons', () => {
    renderRoute(<AnimePage />, '/anime/16bit-sensation', '/anime/:animeId')
    expect(screen.getByRole('heading', { name: /anime · 16bit-sensation/i })).toBeInTheDocument()

    renderRoute(<PlaylistPage />, '/playlist/currently-watching', '/playlist/:playlistId')
    expect(screen.getByRole('heading', { name: /currently watching/i })).toBeInTheDocument()
  })

  it('renders expanded now-playing shell with queue and controls', () => {
    renderRoute(<NowPlayingPage />)
    expect(screen.getByRole('heading', { name: /pop life/i })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /up next/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /queue/i })).toHaveAttribute('aria-selected', 'true')
  })
})
