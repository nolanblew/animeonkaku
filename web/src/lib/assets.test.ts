import { describe, expect, it } from 'vitest'
import { browserAssetUrl } from './assets'

describe('browserAssetUrl', () => {
  it('routes server media through /api and preserves external URLs', () => {
    expect(browserAssetUrl('/v1/media/images/anime/1/poster')).toBe('/api/v1/media/images/anime/1/poster')
    expect(browserAssetUrl('/api/auth/profile/avatar')).toBe('/api/auth/profile/avatar')
    expect(browserAssetUrl('https://cdn.example/art.jpg')).toBe('https://cdn.example/art.jpg')
    expect(browserAssetUrl(null)).toBeUndefined()
  })
})
