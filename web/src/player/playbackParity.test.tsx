import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryThemeDto } from '../lib/library'
import { mapThemeToQueueItem } from './mapping'
import { PlayerProvider, usePlayer } from './PlayerProvider'
import { QueueStore } from './queue'

function theme(overrides: Partial<LibraryThemeDto> = {}): LibraryThemeDto {
  return {
    id: 41,
    animeThemesAnimeId: 9,
    kitsuAnimeIds: ['anime-9'],
    title: 'Signal in Violet',
    themeType: 'OP1',
    artists: [],
    audioUrl: '/v1/media/audio/41',
    videoUrl: null,
    audioState: 'READY',
    durationSeconds: 90,
    fileSize: null,
    mediaModes: {
      tvSize: { url: '/v1/media/audio/41', durationSeconds: 90, fileSize: null },
      fullSize: null,
      video: null,
    },
    updatedAt: 1,
    deleted: false,
    ...overrides,
  }
}

function ModeProbe() {
  const player = usePlayer()
  return <><output data-testid="playback-mode">{player.mode}</output><button type="button" onClick={() => player.setMode('VIDEO')}>Switch to video</button></>
}

function renderPlayer(store: QueueStore, props: Omit<React.ComponentProps<typeof PlayerProvider>, 'children'> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PlayerProvider queueStore={store} {...props}>
        <ModeProbe />
      </PlayerProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => vi.restoreAllMocks())

describe('browser playback preferences and loudness', () => {
  it('carries each ready audio mode loudness profile through queue mapping', () => {
    const tvLoudness = { integratedLufs: -15, truePeakDbtp: -1, loudnessRangeLu: 5, gainDb: -6, policyVersion: 1, state: 'READY' as const }
    const fullLoudness = { integratedLufs: -11, truePeakDbtp: -1, loudnessRangeLu: 7, gainDb: -3, policyVersion: 1, state: 'READY' as const }
    const mapped = mapThemeToQueueItem(theme({
      mediaModes: {
        tvSize: { url: '/v1/media/audio/41', durationSeconds: 90, fileSize: null, loudness: tvLoudness },
        fullSize: { songId: 401, url: '/v1/media/songs/401/audio', durationSeconds: 240, fileSize: null, sourceReleaseId: 4, loudness: fullLoudness },
        video: null,
      },
    }))

    expect(mapped).toMatchObject({ tvLoudness, fullLoudness })
  })

  it('applies ready attenuation to the active browser audio element without allowing a boost', async () => {
    const mapped = mapThemeToQueueItem(theme({
      mediaModes: {
        tvSize: {
          url: '/v1/media/audio/41',
          durationSeconds: 90,
          fileSize: null,
          loudness: { integratedLufs: -8, truePeakDbtp: -1, loudnessRangeLu: 6, gainDb: -6, policyVersion: 1, state: 'READY' },
        },
        fullSize: null,
        video: null,
      },
    }))
    const store = new QueueStore()
    store.play([mapped])
    renderPlayer(store)

    const audio = await waitFor(() => {
      const element = screen.getByTestId('player-audio') as HTMLAudioElement
      expect(element).toHaveAttribute('src', '/api/v1/media/audio/41')
      return element
    })

    expect(audio.volume).toBeCloseTo(10 ** (-6 / 20), 3)
    expect(audio.volume).toBeLessThanOrEqual(1)
  })

  it('remembers the selected audio mode for this browser user across player remounts', () => {
    const store = new QueueStore()
    store.play([mapThemeToQueueItem(theme({
      mediaModes: {
        tvSize: { url: '/v1/media/audio/41', durationSeconds: 90, fileSize: null },
        fullSize: { songId: 401, url: '/v1/media/songs/401/audio', durationSeconds: 240, fileSize: null, sourceReleaseId: 4 },
        video: null,
      },
    }))])

    const first = renderPlayer(store, { persistenceUserId: 'phase4-preferences', initialMode: 'FULL_SIZE' })
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('FULL_SIZE')
    first.unmount()

    renderPlayer(store, { persistenceUserId: 'phase4-preferences' })
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('FULL_SIZE')
  })

  it('keeps Video as a session mode and does not replace the remembered audio default', () => {
    const store = new QueueStore()
    store.play([mapThemeToQueueItem(theme({
      mediaModes: {
        tvSize: { url: '/v1/media/audio/41', durationSeconds: 90, fileSize: null },
        fullSize: { songId: 401, url: '/v1/media/songs/401/audio', durationSeconds: 240, fileSize: null, sourceReleaseId: 4 },
        video: { url: 'https://cdn.example/41.webm', mimeType: 'video/webm', spoiler: false, nsfw: false, entryVersion: 1 },
      },
    }))])

    const first = renderPlayer(store, { persistenceUserId: 'phase4-video-preferences', initialMode: 'FULL_SIZE' })
    fireEvent.click(screen.getByRole('button', { name: 'Switch to video' }))
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('VIDEO')
    first.unmount()

    renderPlayer(store, { persistenceUserId: 'phase4-video-preferences' })
    expect(screen.getByTestId('playback-mode')).toHaveTextContent('FULL_SIZE')
  })
})
