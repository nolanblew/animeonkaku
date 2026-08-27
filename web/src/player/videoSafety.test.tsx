import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { LibraryThemeDto } from '../lib/library'
import { MiniPlayerView } from './MiniPlayerView'
import { NowPlayingView } from './NowPlayingView'
import { mapThemeToQueueItem } from './mapping'
import { PlayerProvider, usePlayer } from './PlayerProvider'
import { QueueStore } from './queue'

const warningTheme: LibraryThemeDto = {
  id: 44,
  animeThemesAnimeId: 9,
  kitsuAnimeIds: ['anime-9'],
  title: 'Opening Theme',
  themeType: 'OP1',
  artists: [{ name: 'Band', asCharacter: null, alias: null }],
  audioUrl: '/v1/media/audio/44',
  videoUrl: 'https://cdn.example/44.webm',
  audioState: 'READY',
  durationSeconds: 90,
  fileSize: null,
  mediaModes: {
    tvSize: { url: '/v1/media/audio/44', durationSeconds: 90, fileSize: null },
    fullSize: null,
    video: { url: 'https://cdn.example/44.webm', mimeType: 'video/webm', spoiler: true, nsfw: true, entryVersion: 1 },
  },
  updatedAt: 1,
  deleted: false,
}

function ModeProbe() {
  const player = usePlayer()
  return <output data-testid="mode">{player.mode}</output>
}

function MiniStartProbe() {
  const player = usePlayer()
  return <>
    <button type="button" onClick={() => player.playTheme(warningTheme, { mode: 'VIDEO' })}>Start video</button>
    <MiniPlayerView />
  </>
}

describe('video safety metadata and confirmation', () => {
  it('preserves spoiler and NSFW flags when mapping a theme into a queue item', () => {
    const mapped = mapThemeToQueueItem(warningTheme)

    expect(mapped).toMatchObject({
      videoSpoiler: true,
      videoNsfw: true,
    })
  })

  it('requires an accessible confirmation before switching a flagged theme to video', async () => {
    const store = new QueueStore()
    store.play([mapThemeToQueueItem(warningTheme)])
    const user = userEvent.setup()
    render(<PlayerProvider queueStore={store}><ModeProbe /><NowPlayingView /></PlayerProvider>)

    await user.click(screen.getByRole('tab', { name: 'Video' }))

    expect(screen.getByTestId('mode')).toHaveTextContent('TV_SIZE')
    expect(screen.getByRole('dialog', { name: 'Video content warning' })).toBeInTheDocument()
    expect(screen.getByText(/spoiler/i)).toBeInTheDocument()
    expect(screen.getByText(/not safe for work|nsfw/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel video' }))
    expect(screen.queryByRole('dialog', { name: 'Video content warning' })).not.toBeInTheDocument()
    expect(screen.getByTestId('mode')).toHaveTextContent('TV_SIZE')

    await user.click(screen.getByRole('tab', { name: 'Video' }))
    await user.click(screen.getByRole('button', { name: 'Continue to video' }))
    await waitFor(() => expect(screen.getByTestId('mode')).toHaveTextContent('VIDEO'))
  })

  it('uses the same confirmation when a video is started from the compact player path', async () => {
    const store = new QueueStore()
    const user = userEvent.setup()
    render(<PlayerProvider queueStore={store}><MiniStartProbe /></PlayerProvider>)

    await user.click(screen.getByRole('button', { name: 'Start video' }))

    expect(screen.getByRole('dialog', { name: 'Video content warning' })).toBeInTheDocument()
    expect(screen.getByTestId('mini-player-view')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel video' })).toBeInTheDocument()
  })
})
