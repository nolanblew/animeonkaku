import { apiClient } from './api'

/** Maps server-owned `/v1` media paths through the browser cookie prefix. */
export function browserAssetUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/api/')) return value
  return apiClient.url(value)
}
