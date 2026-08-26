export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export class ApiError extends Error {
  readonly status: number
  readonly requestId?: string

  constructor(status: number, message = 'The service could not complete that request.', requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
  }
}

export interface ApiClientOptions {
  baseUrl?: string
  fetcher?: typeof fetch
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = baseUrl.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

export class ApiClient {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api'
    this.fetcher = options.fetcher ?? fetch
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')

    let body = init.body
    if (body && typeof body !== 'string' && !(body instanceof FormData) && !(body instanceof Blob)) {
      body = JSON.stringify(body)
      headers.set('Content-Type', 'application/json')
    }

    let response: Response
    try {
      response = await this.fetcher(joinUrl(this.baseUrl, path), {
        ...init,
        body,
        credentials: 'include',
        headers,
      })
    } catch {
      throw new ApiError(0, 'The service could not be reached. Check your connection and try again.')
    }

    if (!response.ok) {
      const requestId = response.headers.get('x-request-id') ?? undefined
      throw new ApiError(response.status, 'The service could not complete that request.', requestId)
    }

    if (response.status === 204) return undefined as T

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return (await response.text()) as T
    return (await response.json()) as T
  }

  get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'GET' })
  }

  post<T>(path: string, body?: JsonValue, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: 'POST', body: body as BodyInit | null | undefined })
  }
}

export const apiClient = new ApiClient()
