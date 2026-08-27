import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '../../lib/api'
import { createEmptyLibrary } from '../../lib/library'
import { SearchPage } from './SearchPage'

vi.mock('../../lib/api', () => ({
  apiClient: { get: vi.fn() },
}))

const mockedGet = vi.mocked(apiClient.get)

afterEach(() => vi.restoreAllMocks())

describe('SearchPage resilience', () => {
  it('keeps the last successful results visible, exposes retry, and recovers after a transient failure', async () => {
    mockedGet
      .mockResolvedValueOnce({ tracks: [{ track: { id: 1, title: 'Opening Theme', artistCredit: 'Band', audioUrl: '/audio/1' } }], releases: [] })
      .mockRejectedValueOnce(new Error('temporary upstream failure'))
      .mockResolvedValueOnce({ tracks: [{ track: { id: 2, title: 'Recovered Theme', artistCredit: 'Band', audioUrl: '/audio/2' } }], releases: [] })

    render(
      <MemoryRouter initialEntries={['/search?q=opening']}>
        <SearchPage library={createEmptyLibrary()} debounceMs={0} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Opening Theme')).toBeInTheDocument())

    const input = screen.getByRole('searchbox', { name: 'Search anime, songs, artists, and playlists' })
    fireEvent.change(input, { target: { value: 'opening retry' } })
    fireEvent.submit(screen.getByRole('search', { name: 'Search music' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not complete search/i))
    expect(screen.getByText('Opening Theme')).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: /retry search/i })

    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('Recovered Theme')).toBeInTheDocument())
    expect(screen.queryByText('temporary upstream failure')).not.toBeInTheDocument()
  })
})
