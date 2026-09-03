import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { createEmptyLibrary } from '../../lib/library'
import { LIBRARY_QUERY_KEY, queryClient } from '../../lib/query'

import { ThemeActionSheet, TrackActionMenu, useLibraryActions } from './index'

function renderWithQuery(ui: React.ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client }
}

function ActionProbe() {
  const actions = useLibraryActions()
  return <div>
    <button onClick={() => void actions.updateThemePreference(41, { liked: true }).catch(() => undefined)}>like</button>
    <button onClick={() => void actions.updateSongPreference(91, { disliked: true }).catch(() => undefined)}>dislike song</button>
    <button onClick={() => void actions.setPreferredMode(41, 'FULL_SIZE').catch(() => undefined)}>full</button>
    <button onClick={() => void actions.addAnimeToLibrary({ kitsuId: 'anime-1', animeThemesId: 9 }).catch(() => undefined)}>add</button>
    <button onClick={() => void actions.removeAnimeFromLibrary('anime-1').catch(() => undefined)}>remove</button>
    <span data-testid="pending">{actions.pendingAction ?? 'none'}</span>
  </div>
}

beforeEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('library action API and hook', () => {
  it('rolls back only the failed preference and preserves concurrent library updates', async () => {
    let rejectRequest!: (reason: Error) => void
    vi.spyOn(apiClient, 'request').mockReturnValue(new Promise((_, reject) => { rejectRequest = reject }) as never)
    const { client } = renderWithQuery(<ActionProbe />, queryClient)
    client.setQueryData(LIBRARY_QUERY_KEY, {
      ...createEmptyLibrary(),
      prefsByThemeId: { '41': { themeId: 41, liked: false, disliked: false } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'like' }))
    expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.prefsByThemeId['41']?.liked).toBe(true)

    client.setQueryData(LIBRARY_QUERY_KEY, (current: ReturnType<typeof createEmptyLibrary>) => ({
      ...current,
      cursor: 77,
    }))
    rejectRequest(new Error('preference unavailable'))

    await waitFor(() => expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.prefsByThemeId['41']?.liked).toBe(false))
    expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.cursor).toBe(77)
  })

  it('does not overwrite a newer server preference when an older request fails', async () => {
    let rejectRequest!: (reason: Error) => void
    vi.spyOn(apiClient, 'request').mockReturnValue(new Promise((_, reject) => { rejectRequest = reject }) as never)
    const { client } = renderWithQuery(<ActionProbe />, queryClient)
    client.setQueryData(LIBRARY_QUERY_KEY, {
      ...createEmptyLibrary(),
      prefsByThemeId: { '41': { themeId: 41, liked: false, disliked: false, updatedAt: 1 } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'like' }))
    client.setQueryData(LIBRARY_QUERY_KEY, (current: ReturnType<typeof createEmptyLibrary>) => ({
      ...current,
      prefsByThemeId: { ...current.prefsByThemeId, '41': { ...current.prefsByThemeId['41']!, liked: true, updatedAt: 2 } },
    }))
    rejectRequest(new Error('older preference request failed'))

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('none'))
    expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.prefsByThemeId['41']).toMatchObject({ liked: true, updatedAt: 2 })
  })

  it('commits the successful server preference over a stale cache refresh', async () => {
    let resolveRequest!: (value: unknown) => void
    vi.spyOn(apiClient, 'request').mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }) as never)
    const { client } = renderWithQuery(<ActionProbe />, queryClient)
    client.setQueryData(LIBRARY_QUERY_KEY, {
      ...createEmptyLibrary(),
      prefsByThemeId: { '41': { themeId: 41, liked: false, disliked: false, dislikedTvSize: false, dislikedFullSize: false, preferredMode: null, playCount: 0, lastPlayedAt: null, updatedAt: 1, deleted: false } },
    })

    await userEvent.click(screen.getByRole('button', { name: 'like' }))
    expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.prefsByThemeId['41']?.liked).toBe(true)

    client.setQueryData(LIBRARY_QUERY_KEY, (current: ReturnType<typeof createEmptyLibrary>) => ({
      ...current,
      prefsByThemeId: { ...current.prefsByThemeId, '41': { ...current.prefsByThemeId['41']!, liked: false } },
    }))
    resolveRequest({ themeId: 41, liked: true, disliked: false, dislikedTvSize: false, dislikedFullSize: false, preferredMode: null, playCount: 0, lastPlayedAt: null, updatedAt: 2, deleted: false })

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('none'))
    expect(client.getQueryData<ReturnType<typeof createEmptyLibrary>>(LIBRARY_QUERY_KEY)?.prefsByThemeId['41']).toMatchObject({ liked: true, updatedAt: 2 })
  })

  it('writes like and preferred mode through the existing theme preference contract', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ themeId: 41, liked: true })
    renderWithQuery(<ActionProbe />)

    await userEvent.click(screen.getByRole('button', { name: 'like' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/themes/41', expect.objectContaining({ method: 'PUT' })))
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ liked: true })

    await userEvent.click(screen.getByRole('button', { name: 'full' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/themes/41', expect.objectContaining({ method: 'PUT' })))
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ preferredMode: 'FULL_SIZE' })

    await userEvent.click(screen.getByRole('button', { name: 'dislike song' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/songs/91', expect.objectContaining({ method: 'PUT' })))
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body))).toEqual({ disliked: true })
  })

  it('adds and removes anime through authenticated library routes', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ accepted: true, queuedJobIds: [] })
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(undefined)
    renderWithQuery(<ActionProbe />)

    await userEvent.click(screen.getByRole('button', { name: 'add' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/library/anime', { kitsuId: 'anime-1', animeThemesId: 9 }))
    await userEvent.click(screen.getByRole('button', { name: 'remove' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/library/anime/anime-1', expect.objectContaining({ method: 'DELETE' })))
  })
})

describe('TrackActionMenu', () => {
  it('shows an optimistic whole-item preference toggle for full-size playback', async () => {
    let resolveRequest!: (value: unknown) => void
    const pendingRequest = new Promise((resolve) => { resolveRequest = resolve })
    const request = vi.spyOn(apiClient, 'request').mockReturnValue(pendingRequest as never)

    renderWithQuery(<TrackActionMenu item={{ itemType: 'THEME', itemId: 41, title: 'Opening theme', modeOverride: 'FULL_SIZE' }} liked={false} disliked={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(screen.getByRole('button', { name: 'Remove like' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dislike' })).toHaveAttribute('aria-pressed', 'false')
    expect(request).toHaveBeenCalledWith('/v1/prefs/themes/41', expect.objectContaining({ body: JSON.stringify({ liked: true }) }))

    resolveRequest({ themeId: 41, liked: true, disliked: false })
  })

  it('opens playback-size dislike choices on right-click and writes the selected scope', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ themeId: 41, liked: false, disliked: false, dislikedTvSize: false, dislikedFullSize: true })
    const onDislike = vi.fn()
    renderWithQuery(<TrackActionMenu item={{ itemType: 'THEME', itemId: 41, title: 'Opening theme', modeOverride: 'FULL_SIZE' }} hasFullSize onDislike={onDislike} />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Dislike' }))
    const menu = screen.getByRole('menu', { name: 'Choose dislike scope for Opening theme' })
    expect(within(menu).getByRole('menuitem', { name: 'Dislike TV Size' })).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Dislike Full Size' }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/themes/41', expect.objectContaining({ body: JSON.stringify({ dislikedFullSize: true }) })))
    expect(onDislike).toHaveBeenCalledOnce()
  })

  it('opens playback-size dislike choices after a touch long-press without applying a whole-theme dislike', async () => {
    vi.useFakeTimers()
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({})
    try {
      renderWithQuery(<TrackActionMenu item={{ itemType: 'THEME', itemId: 41, title: 'Opening theme' }} hasFullSize />)
      const dislike = screen.getByRole('button', { name: 'Dislike' })

      fireEvent.pointerDown(dislike, { pointerType: 'touch', pointerId: 7 })
      act(() => { vi.advanceTimersByTime(600) })
      fireEvent.pointerUp(dislike, { pointerType: 'touch', pointerId: 7 })
      fireEvent.click(dislike)

      expect(screen.getByRole('menu', { name: 'Choose dislike scope for Opening theme' })).toBeInTheDocument()
      expect(request).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses separate mobile-style like and dislike controls and exposes a working action menu', async () => {
    const onPlayNext = vi.fn()
    const onAddToQueue = vi.fn()
    const onRemove = vi.fn()
    renderWithQuery(<TrackActionMenu item={{ itemType: 'SONG', itemId: 91, title: 'Full song' }} liked disliked={false} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onRemove={onRemove} />)

    expect(screen.getByRole('button', { name: 'Remove like' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Dislike' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByLabelText(/heart|favorite/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Full song' }))
    expect(screen.getByRole('menu', { name: 'Full song actions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Play next' }))
    expect(onPlayNext).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Full song' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))
    expect(onAddToQueue).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Full song' }))
    expect(screen.getByRole('menuitem', { name: 'Save to playlist' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove from playlist' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('persists song thumbs and saves the same song to existing or new playlists', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ playlist: { id: 5, name: 'Road trip' } })
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([{ id: 5, name: 'Road trip', entries: [], items: [], defaultMode: 'TV_SIZE', overrideUserPreference: false, isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 1, deleted: false, dynamicSpecJson: null, dynamicSortJson: null }])
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ playlist: { id: 6, name: 'New mix' } })
    renderWithQuery(<TrackActionMenu item={{ itemType: 'SONG', itemId: 91, title: 'Full song' }} />)

    await userEvent.click(screen.getByRole('button', { name: 'Like' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dislike' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/songs/91', expect.objectContaining({ method: 'PUT' })))

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Full song' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save to playlist' }))
    expect(await screen.findByRole('dialog', { name: 'Save to playlist' })).toBeInTheDocument()
    expect(get).toHaveBeenCalled()
    await userEvent.click((await screen.findByText('Road trip')).closest('button')!)
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/playlists/5', expect.objectContaining({ method: 'PUT' })))

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Full song' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save to playlist' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'New playlist name' }), 'New mix')
    await userEvent.click(screen.getByRole('button', { name: 'Create playlist' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/playlists', expect.objectContaining({ name: 'New mix', items: [{ itemType: 'SONG', itemId: 91, modeOverride: null }] })))
  })

  it('exposes the complete context-aware track action model through one menu', async () => {
    const callbacks = {
      onPlayNext: vi.fn(),
      onAddToQueue: vi.fn(),
      onReplaceQueue: vi.fn(),
      onPlayVideo: vi.fn(),
      onGoToArtist: vi.fn(),
      onGoToAnime: vi.fn(),
      onRelatedMusic: vi.fn(),
      onSetPreferredMode: vi.fn(),
      onRemove: vi.fn(),
    }
    renderWithQuery(
      <TrackActionMenu
        item={{ itemType: 'THEME', itemId: 41, title: 'Opening theme' }}
        hasFullSize
        preferredMode={null}
        artistName="Aimer"
        animeName="Frieren"
        removeLabel="Remove from queue"
        {...callbacks}
      />,
    )

    const openMenu = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'More actions for Opening theme' }))
      return screen.getByRole('menu', { name: 'Opening theme actions' })
    }

    let menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Play next' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Add to queue' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Replace queue' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Save to playlist' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Play Video' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Go to Aimer' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Go to Frieren' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Related Music' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Prefer Full Size' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Remove from queue' })).toBeInTheDocument()

    const clickAction = async (name: string) => {
      await userEvent.click(within(menu).getByRole('menuitem', { name }))
      menu = await openMenu()
    }
    await clickAction('Play next')
    await clickAction('Add to queue')
    await clickAction('Replace queue')
    await clickAction('Play Video')
    await clickAction('Go to Aimer')
    await clickAction('Go to Frieren')
    await clickAction('Related Music')
    await clickAction('Prefer Full Size')
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove from queue' }))

    expect(callbacks.onPlayNext).toHaveBeenCalledOnce()
    expect(callbacks.onAddToQueue).toHaveBeenCalledOnce()
    expect(callbacks.onReplaceQueue).toHaveBeenCalledOnce()
    expect(callbacks.onPlayVideo).toHaveBeenCalledOnce()
    expect(callbacks.onGoToArtist).toHaveBeenCalledOnce()
    expect(callbacks.onGoToAnime).toHaveBeenCalledOnce()
    expect(callbacks.onRelatedMusic).toHaveBeenCalledOnce()
    expect(callbacks.onSetPreferredMode).toHaveBeenCalledWith('FULL_SIZE')
    expect(callbacks.onRemove).toHaveBeenCalledOnce()
  })
})

describe('ThemeActionSheet', () => {
  it('exposes mobile-equivalent play, preference, library, and queue actions accessibly', async () => {
    const onPlay = vi.fn()
    const onPlayNext = vi.fn()
    const onAddToQueue = vi.fn()
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ themeId: 41, liked: true })
    renderWithQuery(<ThemeActionSheet themeId={41} title="Opening theme" subtitle="Anime · OP1" liked={false} disliked={false} inLibrary={false} hasFullSize onPlay={onPlay} onPlayNext={onPlayNext} onAddToQueue={onAddToQueue} onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Opening theme actions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Play next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play now' }))
    expect(onPlayNext).toHaveBeenCalledOnce()
    expect(onAddToQueue).toHaveBeenCalledOnce()
    expect(onPlay).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: 'Like' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/prefs/themes/41', expect.objectContaining({ method: 'PUT' })))
  })

  it('adds selected themes to a playlist with an explicit mode override or creates a playlist', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue([{ id: 5, name: 'Favorites', entries: [10], defaultMode: 'TV_SIZE', overrideUserPreference: false, items: [{ entryId: 1, itemType: 'THEME', itemId: 10, modeOverride: null }], isAuto: false, isDynamic: false, autoUpdate: false, updatedAt: 1, deleted: false, dynamicSpecJson: null, dynamicSortJson: null }])
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ playlist: { id: 5, name: 'Favorites' } })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ playlist: { id: 8, name: 'New themes' } })
    renderWithQuery(<ThemeActionSheet themeId={41} selectedThemeIds={[41, 42]} title="Opening theme" subtitle="Anime · OP1" liked={false} disliked={false} inLibrary inAnimeLibrary onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save to playlist' }))
    expect(await screen.findByRole('dialog', { name: 'Save to playlist' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith('/v1/playlists', expect.anything())
    await userEvent.click(screen.getByRole('button', { name: 'Full Size' }))
    await userEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/playlists/5', expect.objectContaining({ method: 'PUT' })))
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).items).toEqual([
      { entryId: 1, itemType: 'THEME', itemId: 10, modeOverride: null },
      { itemType: 'THEME', itemId: 41, modeOverride: 'FULL_SIZE' },
      { itemType: 'THEME', itemId: 42, modeOverride: 'FULL_SIZE' },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Save to playlist' }))
    await userEvent.click(await screen.findByRole('button', { name: 'New playlist' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'New playlist name' }), 'New themes')
    await userEvent.click(screen.getByRole('button', { name: 'Create playlist' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/v1/playlists', expect.objectContaining({ name: 'New themes' })))
  })

  it('shows sanitized failure details and supports removing an existing dislike', async () => {
    vi.spyOn(apiClient, 'request').mockRejectedValue(new Error('token=should-not-render'))
    renderWithQuery(<ThemeActionSheet themeId={41} title="Opening theme" subtitle="Anime · OP1" liked={false} disliked onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove dislike' }))
    expect(await screen.findByText('Could not complete that action.')).toBeInTheDocument()
    expect(screen.queryByText('should-not-render')).not.toBeInTheDocument()
  })

  it('requires confirmation before removing an anime from the library', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue(undefined)
    renderWithQuery(<ThemeActionSheet themeId={41} title="Opening theme" subtitle="Anime · OP1" liked={false} disliked={false} inAnimeLibrary animeKitsuId="anime-1" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove anime from library' }))
    expect(request).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm remove anime' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('/v1/library/anime/anime-1', expect.objectContaining({ method: 'DELETE' })))
  })
})
