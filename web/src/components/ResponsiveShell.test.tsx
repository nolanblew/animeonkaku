import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResponsiveShell } from './ResponsiveShell'
import { PlayerProvider } from '../player'
import '../styles.css'

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { username: 'fan', displayName: 'Anime Fan', avatarUrl: '/custom-avatar.png', kitsuAvatarUrl: 'https://media.kitsu.app/kitsu-avatar.png' },
    firstSync: { status: 'ready' },
    reauthentication: { status: 'idle' },
    logout: vi.fn(),
  }),
}))

vi.mock('../lib/query', () => ({
  useLibraryQuery: () => ({
    library: {
      animeById: {
        naruto: { kitsuId: 'naruto', title: 'Naruto', titleEn: 'Naruto', titleRomaji: 'Naruto', titleJa: 'ナルト', posterUrl: '/naruto.jpg', deleted: false },
      },
      themesById: {
        '11': { id: 11, title: 'Blue Bird', themeType: 'OP3', kitsuAnimeIds: ['naruto'], artists: [{ name: 'Ikimonogakari', alias: null, asCharacter: null }], deleted: false },
      },
      playlistsById: {
        '7': { id: 7, name: 'A very long night drive playlist name that must remain discoverable', deleted: false, isAuto: false, isDynamic: false, items: [], entries: [] },
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
    const playlistLink = screen.getByRole('link', { name: 'A very long night drive playlist name that must remain discoverable' })
    expect(playlistLink).toHaveAttribute('href', '/playlist/7')
    expect(playlistLink).toHaveAttribute('title', 'A very long night drive playlist name that must remain discoverable')
    expect(playlistLink.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /new playlist/i })).toHaveAttribute('href', '/playlists?create=1')
    expect(screen.getByRole('button', { name: 'Open profile menu' }).querySelector('img')).toHaveAttribute('src', 'https://media.kitsu.app/kitsu-avatar.png')
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

    const searchInput = screen.getByRole('combobox', { name: /search songs/i }) as HTMLInputElement
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

  it('shows an instant library-only suggestion panel and sends Enter to the full search page', () => {
    function LocationProbe() {
      return <output aria-label="Current route">{useLocation().pathname}{useLocation().search}</output>
    }
    render(
      <MemoryRouter initialEntries={['/library']}>
        <PlayerProvider>
          <Routes>
            <Route path="*" element={<ResponsiveShell><LocationProbe /></ResponsiveShell>} />
          </Routes>
        </PlayerProvider>
      </MemoryRouter>,
    )

    const searchInput = screen.getByRole('combobox', { name: /search songs/i })
    fireEvent.focus(searchInput)
    fireEvent.change(searchInput, { target: { value: 'naruto' } })

    const suggestions = screen.getByRole('dialog', { name: /library search suggestions/i })
    expect(suggestions).toHaveTextContent('From your library')
    expect(screen.getByRole('link', { name: /Naruto/i })).toHaveAttribute('href', '/anime/naruto')
    expect(suggestions).not.toHaveTextContent('AnimeThemes')

    fireEvent.keyDown(searchInput, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /library search suggestions/i })).not.toBeInTheDocument()
    fireEvent.focus(searchInput)
    fireEvent.keyDown(searchInput, { key: 'Enter' })
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/search?q=naruto')
  })
})
