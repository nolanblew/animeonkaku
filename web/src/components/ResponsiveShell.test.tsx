import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveShell } from './ResponsiveShell'
import { PlayerProvider } from '../player'
import '../styles.css'

vi.mock('../lib/query', () => ({
  useLibraryQuery: () => ({
    library: {
      playlistsById: {
        '7': { id: 7, name: 'Night drive', deleted: false, isAuto: false, isDynamic: false, items: [], entries: [] },
      },
    },
  }),
}))

afterEach(() => vi.restoreAllMocks())

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
    expect(screen.getByRole('img', { name: 'Anime Ongaku' })).toHaveAttribute('src', expect.stringContaining('anime-ongaku-logo'))
    expect(screen.getByRole('heading', { name: 'Playlists' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Night drive' })).toHaveAttribute('href', '/playlist/7')
    expect(screen.getByRole('link', { name: /new playlist/i })).toHaveAttribute('href', '/playlists?create=1')
  })

  it.each([
    ['Meta+K', { metaKey: true }],
    ['Ctrl+K', { ctrlKey: true }],
  ])('focuses and selects the global search input for %s', (_shortcut, modifiers) => {
    render(
      <MemoryRouter initialEntries={['/library']}>
        <PlayerProvider><ResponsiveShell><h1>Library content</h1></ResponsiveShell></PlayerProvider>
      </MemoryRouter>,
    )

    const searchInput = screen.getByRole('textbox', { name: /search songs/i }) as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'bleach' } })
    searchInput.blur()
    fireEvent.keyDown(window, { key: 'k', ...modifiers })

    expect(document.activeElement).toBe(searchInput)
    expect(searchInput.selectionStart).toBe(0)
    expect(searchInput.selectionEnd).toBe('bleach'.length)
  })

  it('removes the global search shortcut listener when unmounted', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(
      <MemoryRouter initialEntries={['/library']}>
        <PlayerProvider><ResponsiveShell><h1>Library content</h1></ResponsiveShell></PlayerProvider>
      </MemoryRouter>,
    )

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})
