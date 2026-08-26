import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiClient, ApiError } from './api'

describe('ApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the /api boundary and includes credentials for session cookies', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'fan-1' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const client = new ApiClient()

    await expect(client.get('/profile')).resolves.toEqual({ id: 'fan-1' })
    const [, request] = fetchMock.mock.calls[0] ?? []
    expect(request?.credentials).toBe('include')
    expect(new Headers(request?.headers).get('Accept')).toBe('application/json')
  })

  it('normalizes non-success responses into an API error without exposing the body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('database password leaked', { status: 500, statusText: 'Server Error' }),
    )
    const client = new ApiClient()

    await expect(client.get('/profile')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'The service could not complete that request.',
    })
  })

  it('serializes JSON POST bodies and handles empty and text responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('accepted', { status: 200, headers: { 'content-type': 'text/plain' } }))
    const client = new ApiClient()

    await expect(client.post('/auth/logout', { session: 'current' })).resolves.toBeUndefined()
    await expect(client.get('/healthz')).resolves.toBe('accepted')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ session: 'current' }))
  })

  it('reports transport failures as a user-safe error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    await expect(new ApiClient().get('/healthz')).rejects.toMatchObject({ status: 0, message: 'The service could not be reached. Check your connection and try again.' })
  })
})
