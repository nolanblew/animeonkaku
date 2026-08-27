import { describe, expect, it } from 'vitest'
import { ManagedMediaCache, type CacheStoragePort } from './managedCache'

class MemoryStorage implements CacheStoragePort {
  async open() {
    return {
      async keys() { return [] as string[] },
      async match() { return undefined },
      async put() { /* cache namespace test does not populate entries */ },
      async delete() { return true },
    }
  }

  async delete() { return true }
}

describe('ManagedMediaCache account namespaces', () => {
  it('uses a deterministic user-scoped namespace across provider mounts', () => {
    const storage = new MemoryStorage()
    const firstMount = new ManagedMediaCache({
      storage,
      userId: 'nblewtest',
      baseUrl: 'https://ongaku.test/',
    })
    const secondMount = new ManagedMediaCache({
      storage,
      userId: 'nblewtest',
      baseUrl: 'https://ongaku.test/',
    })
    const differentUser = new ManagedMediaCache({
      storage,
      userId: 'another-user',
      baseUrl: 'https://ongaku.test/',
    })

    expect(firstMount.audioCacheName).toBe(secondMount.audioCacheName)
    expect(firstMount.imageCacheName).toBe(secondMount.imageCacheName)
    expect(firstMount.audioCacheName).not.toBe(differentUser.audioCacheName)
    expect(firstMount.imageCacheName).not.toBe(differentUser.imageCacheName)
  })
})
