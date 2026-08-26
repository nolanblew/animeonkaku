import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { NowPlayingPage, SearchPage, ServerErrorPage, SettingsPage } from './Pages'
import { AppQueryProvider } from '../lib/query'
import { PlayerProvider } from '../player'

function renderRoute(element: React.ReactElement, path = '/', routePath = '*') {
  return render(<AppQueryProvider><PlayerProvider><MemoryRouter initialEntries={[path]}><Routes><Route path={routePath} element={element} /></Routes></MemoryRouter></PlayerProvider></AppQueryProvider>)
}

describe('intentional route surfaces', () => {
  it.each([
    ['settings', SettingsPage, 'Account settings'],
    ['error', ServerErrorPage, 'We’re tuning the signal'],
  ])('renders the %s route', async (_route, Page, heading) => {
    renderRoute(<Page />)
    await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument())
  })

  it('loads the routed query into functional search', async () => {
    renderRoute(<SearchPage />, '/search?q=naruto')
    await waitFor(() => expect(screen.getByRole('heading', { name: /^search$/i })).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: /search anime/i })).toHaveValue('naruto')
  })

  it('renders the functional now-playing controls', () => {
    renderRoute(<NowPlayingPage />)
    expect(screen.getByRole('heading', { name: /^now playing$/i, level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/nothing playing/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /play current track/i })).toBeDisabled()
  })
})
