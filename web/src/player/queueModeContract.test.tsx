import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NowPlayingView, PlayerProvider, QueueStore, usePlayer } from './index'
import { resolveQueueItemPolicy } from './preferenceQueue'
import type { QueueItem } from './queue'
import type { QueuePreferenceSnapshot } from './preferenceQueue'

const emptyPreferences: QueuePreferenceSnapshot = { themesById: {}, songsById: {} }

function theme(
  id: number,
  options: {
    tv?: boolean
    full?: boolean
    video?: boolean
    requiredMode?: 'TV_SIZE' | 'FULL_SIZE' | 'VIDEO'
    mode?: 'TV_SIZE' | 'FULL_SIZE' | 'VIDEO'
    softMode?: 'TV_SIZE' | 'FULL_SIZE'
  } = {},
): QueueItem {
  return {
    id: `theme-${id}`,
    title: `Theme ${id}`,
    itemType: 'THEME',
    themeId: id,
    ...(options.tv === false ? {} : { tvAudioUrl: `/tv/${id}` }),
    ...(options.full === false ? {} : { fullAudioUrl: `/full/${id}` }),
    ...(options.video ? { videoUrl: `/video/${id}` } : {}),
    ...(options.requiredMode ? { requiredMode: options.requiredMode } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.softMode ? { softMode: options.softMode } : {}),
  }
}

function ContractHarness() {
  const player = usePlayer()
  return (
    <>
      <output data-testid="contract-current">{player.currentEntry?.queueId ?? 'none'}</output>
      <output data-testid="contract-mode">{player.mode}</output>
      <output data-testid="contract-status">{player.error ?? 'ok'}</output>
      <NowPlayingView />
    </>
  )
}

function renderContract(store: QueueStore, preferenceSnapshot = emptyPreferences) {
  return render(
    <PlayerProvider queueStore={store} preferenceSnapshot={preferenceSnapshot}>
      <ContractHarness />
    </PlayerProvider>,
  )
}

function preference(themesById: QueuePreferenceSnapshot['themesById']): QueuePreferenceSnapshot {
  return { themesById, songsById: {} }
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('queue mode contract', () => {
  it('resolves a mixed queue as Full, Full, TV fallback, then Full', () => {
    const store = new QueueStore()
    store.play([
      theme(1),
      theme(2, { tv: false }),
      theme(3, { full: false }),
      theme(4),
    ], { desiredMode: 'FULL_SIZE' })
    store.setPreferenceSnapshot(emptyPreferences)

    const actualModes = [0, 1, 2, 3].map(() => {
      const actual = resolveQueueItemPolicy(store.currentEntry!.item, emptyPreferences, store.state.desiredMode).actualMode
      store.next()
      return actual
    })

    expect(actualModes).toEqual(['FULL_SIZE', 'FULL_SIZE', 'TV_SIZE', 'FULL_SIZE'])
  })

  it('allows a manual disliked mode, then follows a newly applied dislike to fallback and skip', async () => {
    const store = new QueueStore()
    store.play([theme(1), theme(2, { full: false })])
    const rendered = renderContract(store)

    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/1'))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Full size' })) })
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/full/1'))

    rendered.rerender(
      <PlayerProvider queueStore={store} preferenceSnapshot={preference({ 1: { dislikedTvSize: true } })}>
        <ContractHarness />
      </PlayerProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/full/1'))

    rendered.rerender(
      <PlayerProvider queueStore={store} preferenceSnapshot={preference({ 1: { dislikedFullSize: true } })}>
        <ContractHarness />
      </PlayerProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/1'))

    rendered.rerender(
      <PlayerProvider queueStore={store} preferenceSnapshot={preference({ 1: { disliked: true } })}>
        <ContractHarness />
      </PlayerProvider>,
    )
    await waitFor(() => expect(store.currentEntry?.item.id).toBe('theme-2'))
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/2'))
  })

  it('marks an available disliked mode and lets an explicit click play it', async () => {
    const store = new QueueStore()
    store.play([theme(16)])
    renderContract(store, preference({ 16: { dislikedFullSize: true } }))

    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/16'))
    const fullTab = screen.getByRole('tab', { name: /^Full size, disliked; select to play anyway$/i })
    expect(fullTab).toHaveAttribute('data-disliked', 'true')

    await act(async () => { fireEvent.click(fullTab) })
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/full/16'))
    expect(store.currentEntry?.manualMode).toBe('FULL_SIZE')
  })

  it('uses the latest queue desired mode for repeated provider source changes', async () => {
    const store = new QueueStore()
    store.play([theme(17)], { desiredMode: 'TV_SIZE' })
    renderContract(store)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/17'))

    await act(async () => { store.setDesiredMode('FULL_SIZE') })
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/full/17'))
    await act(async () => { store.setDesiredMode('TV_SIZE') })
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/17'))
  })

  it('retains focused mode tab identity across audio time updates', async () => {
    const store = new QueueStore()
    store.play([theme(26)])
    renderContract(store)

    const fullTab = await screen.findByRole('tab', { name: 'Full size' })
    fullTab.focus()
    expect(document.activeElement).toBe(fullTab)

    const audio = screen.getByTestId('player-audio')
    Object.defineProperty(audio, 'currentTime', { configurable: true, value: 11 })
    await act(async () => { fireEvent.timeUpdate(audio) })

    expect(screen.getByRole('tab', { name: 'Full size' })).toBe(fullTab)
    expect(document.activeElement).toBe(fullTab)
  })

  it('keeps a replayed occurrence on its recorded TV source after loadedmetadata', async () => {
    const store = new QueueStore()
    store.play([theme(21), theme(22)], { desiredMode: 'TV_SIZE' })
    renderContract(store)
    const audio = screen.getByTestId('player-audio')

    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/21'))
    await act(async () => { fireEvent.loadedMetadata(audio) })
    expect(store.currentEntry?.lastActualMode).toBe('TV_SIZE')

    await act(async () => { store.next() })
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/22'))
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Full size' })) })
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/full/22'))
    await act(async () => { fireEvent.loadedMetadata(audio) })
    expect(store.currentEntry?.lastActualMode).toBe('FULL_SIZE')

    // Manual Full-size selection changes the queue intent. Previous must still
    // replay A's recorded TV occurrence, including after metadata is loaded.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous track' })) })
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/21'))
    await act(async () => { fireEvent.loadedMetadata(audio) })
    expect(audio).toHaveAttribute('src', '/api/tv/21')
    expect(screen.getByTestId('contract-mode')).toHaveTextContent('TV_SIZE')
  })

  it('restores a persisted current occurrence on its recorded mode before and after metadata', async () => {
    const seeded = new QueueStore()
    seeded.play([theme(23)], { desiredMode: 'FULL_SIZE' })
    const queueId = seeded.currentEntry!.queueId
    seeded.recordActualMode(queueId, 'TV_SIZE')
    seeded.setDesiredMode('FULL_SIZE')
    expect(seeded.currentEntry).toMatchObject({ lastActualMode: 'TV_SIZE' })
    expect(seeded.currentEntry?.replayRequested).not.toBe(true)

    const restored = new QueueStore()
    restored.restore(JSON.parse(JSON.stringify(seeded.state)))
    expect(restored.currentEntry).toMatchObject({ lastActualMode: 'TV_SIZE', replayRequested: true })
    renderContract(restored)
    const audio = screen.getByTestId('player-audio')
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/23'))
    await act(async () => { fireEvent.loadedMetadata(audio) })
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/23'))
    expect(screen.getByTestId('contract-mode')).toHaveTextContent('TV_SIZE')
  })

  it('restores each recorded occurrence mode when repeat-all wraps', async () => {
    const store = new QueueStore()
    store.play([theme(24), theme(25)], { desiredMode: 'TV_SIZE' })
    store.setRepeatMode('all')
    renderContract(store)
    const audio = screen.getByTestId('player-audio')

    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/24'))
    await act(async () => { fireEvent.loadedMetadata(audio) })
    await act(async () => { store.next() })
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Full size' })) })
    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/full/25'))
    await act(async () => { fireEvent.loadedMetadata(audio) })

    await act(async () => { store.next() })

    await waitFor(() => expect(audio).toHaveAttribute('src', '/api/tv/24'))
    expect(store.currentEntry).toMatchObject({ lastActualMode: 'TV_SIZE', replayRequested: true })
  })

  it('does not unskip blocked history for transport Previous, while an explicit row replay can', async () => {
    const store = new QueueStore()
    store.play([theme(1), theme(2)])
    store.setPreferenceSnapshot(emptyPreferences)
    store.next()
    const blockedHistoryId = store.state.historyEntries[0]!.queueId
    const currentId = store.currentEntry!.queueId
    const rendered = renderContract(store, preference({ 1: { disliked: true } }))

    await waitFor(() => expect(store.currentEntry?.queueId).toBe(currentId))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Previous track' })) })
    expect(store.currentEntry?.queueId).toBe(currentId)
    expect(store.state.unskippedEntryIds).not.toContain(blockedHistoryId)
    expect(store.state.historyEntries.some((entry) => entry.queueId === blockedHistoryId)).toBe(true)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show queue' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Replay Theme 1' })) })
    expect(store.currentEntry?.queueId).toBe(blockedHistoryId)
    expect(store.state.unskippedEntryIds).toContain(blockedHistoryId)
  })

  it('mutes skipped history and upcoming rows while an explicit row click unskips playback', async () => {
    const store = new QueueStore()
    store.play([theme(27), theme(28), theme(29)])
    store.next()
    const rendered = renderContract(store, preference({ 27: { disliked: true }, 29: { disliked: true } }))

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show queue' })) })
    const queue = screen.getByRole('complementary', { name: 'Playback queue' })
    const historyRow = screen.getByRole('button', { name: 'Replay Theme 27' }).closest('li')
    const currentRow = screen.getByText('Theme 28', { selector: '.player-queue__title' }).closest('li')
    const upcomingButton = screen.getByRole('button', { name: 'Play Theme 29' })
    const upcomingRow = upcomingButton.closest('li')

    expect(historyRow).toHaveClass('player-queue__row--skipped')
    expect(within(historyRow!).getByText('Skipped automatically')).toBeInTheDocument()
    expect(currentRow).not.toHaveClass('player-queue__row--skipped')
    expect(within(currentRow!).queryByText('Skipped automatically')).not.toBeInTheDocument()
    expect(upcomingRow).toHaveClass('player-queue__row--skipped')
    expect(upcomingButton).not.toBeDisabled()
    expect(upcomingButton).toHaveAttribute('aria-describedby', 'queue-entry-status-3')
    expect(within(upcomingRow!).getByText('Skipped automatically')).toBeInTheDocument()

    await act(async () => { fireEvent.click(upcomingButton) })
    await waitFor(() => expect(store.currentEntry?.queueId).toBe(3))
    expect(store.state.unskippedEntryIds).toContain(3)
    rendered.unmount()
  })

  it('keeps the recorded actual mode across repeat-one and persistence restore', () => {
    const store = new QueueStore()
    store.play([theme(8)], { desiredMode: 'FULL_SIZE' })
    const queueId = store.currentEntry!.queueId
    store.recordActualMode(queueId, 'FULL_SIZE')
    store.setRepeatMode('one')

    expect(store.next()).toBe(0)
    expect(store.currentEntry?.lastActualMode).toBe('FULL_SIZE')

    const restored = new QueueStore()
    restored.restore(JSON.parse(JSON.stringify(store.state)))
    expect(restored.state.desiredMode).toBe('FULL_SIZE')
    expect(restored.currentEntry?.lastActualMode).toBe('FULL_SIZE')
    expect(restored.next()).toBe(0)
    expect(restored.currentEntry?.lastActualMode).toBe('FULL_SIZE')
  })

  it('keeps one duplicate occurrence unskipped through reorder and unrelated preference hydration', () => {
    const store = new QueueStore()
    const duplicate = theme(18)
    store.play([theme(19), duplicate, duplicate, theme(20)])
    const duplicateEntries = store.state.nowPlayingEntries.filter((entry) => entry.item.id === duplicate.id)
    const firstDuplicateId = duplicateEntries[0]!.queueId
    const secondDuplicateId = duplicateEntries[1]!.queueId
    const targetId = store.state.nowPlayingEntries[3]!.queueId

    store.setPreferenceSnapshot(preference({ 18: { disliked: true } }))
    store.unskipEntry(secondDuplicateId)
    store.recordActualMode(secondDuplicateId, 'FULL_SIZE')
    store.moveEntry(secondDuplicateId, targetId)
    store.setPreferenceSnapshot(preference({ 18: { disliked: true }, 20: { disliked: true } }))

    expect(store.state.unskippedEntryIds).toEqual([secondDuplicateId])
    expect(store.state.nowPlayingEntries.find((entry) => entry.queueId === firstDuplicateId)?.unskipped).toBeUndefined()
    expect(store.state.nowPlayingEntries.find((entry) => entry.queueId === secondDuplicateId)).toMatchObject({ lastActualMode: 'FULL_SIZE', unskipped: true })
  })

  it('resets queue desired mode when preference filtering exhausts the queue', async () => {
    const store = new QueueStore()
    store.play([theme(9)], { desiredMode: 'FULL_SIZE' })
    const rendered = renderContract(store)
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/full/9'))

    rendered.rerender(
      <PlayerProvider queueStore={store} preferenceSnapshot={preference({ 9: { disliked: true } })}>
        <ContractHarness />
      </PlayerProvider>,
    )
    await waitFor(() => expect(store.state.desiredMode).toBeUndefined())
    expect(screen.getByTestId('contract-status')).toHaveTextContent(/no allowed version/i)
  })

  it('does not invalidate a restored unskip before preferences are ready', async () => {
    const store = new QueueStore()
    store.play([theme(13)])
    const queueId = store.currentEntry!.queueId
    // Persist the exception with the last synchronized preference state. The
    // provider must not compare it against an empty pre-hydration snapshot.
    store.setPreferenceSnapshot(preference({ 13: { disliked: true } }))
    store.unskipEntry(queueId)
    const view = (preferencesReady: boolean) => (
      <PlayerProvider
        queueStore={store}
        preferencesReady={preferencesReady}
        preferenceSnapshot={preference({ 13: { disliked: true } })}
      >
        <ContractHarness />
      </PlayerProvider>
    )

    const rendered = render(view(false))
    expect(screen.getByTestId('player-audio')).not.toHaveAttribute('src')
    rendered.rerender(view(true))
    await waitFor(() => expect(screen.getByTestId('player-audio')).toHaveAttribute('src', '/api/tv/13'))
    expect(store.currentEntry?.queueId).toBe(queueId)
    expect(store.state.unskippedEntryIds).toContain(queueId)
  })

  it('exposes only strict-compatible mode tabs for mixed required entries', async () => {
    const tvStore = new QueueStore()
    tvStore.play([theme(10, { requiredMode: 'TV_SIZE' })])
    renderContract(tvStore)
    expect(await screen.findByRole('tab', { name: 'TV size' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Full size' })).not.toBeInTheDocument()

    cleanup()
    const fullStore = new QueueStore()
    fullStore.play([theme(11, { requiredMode: 'FULL_SIZE' })])
    renderContract(fullStore)
    expect(await screen.findByRole('tab', { name: 'Full size' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'TV size' })).not.toBeInTheDocument()
  })

  it('lets a newer soft action supersede an older Video intent, then lets manual mode win', () => {
    const item = theme(12, { video: true })
    const fromVideo = resolveQueueItemPolicy(item, emptyPreferences, 'VIDEO')
    expect(fromVideo).toMatchObject({ desiredMode: 'VIDEO', actualMode: 'VIDEO' })

    const fromNewSoft = resolveQueueItemPolicy(item, emptyPreferences, 'VIDEO', undefined, { softMode: 'FULL_SIZE' })
    expect(fromNewSoft).toMatchObject({ desiredMode: 'FULL_SIZE', actualMode: 'FULL_SIZE' })

    const fromManual = resolveQueueItemPolicy(item, preference({ 12: { dislikedTvSize: true } }), 'VIDEO', 'TV_SIZE', { softMode: 'FULL_SIZE', allowDisliked: true })
    expect(fromManual).toMatchObject({ desiredMode: 'TV_SIZE', actualMode: 'TV_SIZE' })
  })

  it('keeps strict Video behind the required audio gate and rejects missing required audio', () => {
    const strictVideo = resolveQueueItemPolicy(
      theme(14, { video: true, requiredMode: 'TV_SIZE' }),
      emptyPreferences,
      'VIDEO',
    )
    expect(strictVideo).toMatchObject({ desiredMode: 'VIDEO', actualMode: 'VIDEO' })

    const missingRequired = resolveQueueItemPolicy(
      theme(15, { tv: false, video: true, requiredMode: 'TV_SIZE' }),
      emptyPreferences,
      'VIDEO',
    )
    expect(missingRequired).toMatchObject({ actualMode: null, reason: 'REQUIRED_UNAVAILABLE' })
  })
})
