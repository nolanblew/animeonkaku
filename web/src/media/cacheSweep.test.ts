import { describe, expect, it } from 'vitest'
import {
  sweepManagedMediaCaches,
  type CacheBucket,
  type CacheStoragePort,
} from './managedCache'

class MemoryBucket implements CacheBucket {
  async keys() { return [] as string[] }
  async match() { return undefined }
  async put() { /* sweep does not populate entries */ }
  async delete() { return true }
}

class MemoryStorage implements CacheStoragePort {
  readonly buckets = new Map<string, MemoryBucket>()

  async keys() { return [...this.buckets.keys()] }

  async open(name: string) {
    let bucket = this.buckets.get(name)
    if (!bucket) {
      bucket = new MemoryBucket()
      this.buckets.set(name, bucket)
    }
    return bucket
  }

  async delete(name: string) {
    return this.buckets.delete(name)
  }
}

describe('ManagedMediaCache namespace sweeping', () => {
  it('removes orphaned versions for one account while preserving its current buckets', async () => {
    const storage = new MemoryStorage()
    const names = [
      'anime-ongaku-next-audio-account-one-v1',
      'anime-ongaku-images-account-one-v1',
      'anime-ongaku-next-audio-account-one-v2',
      'anime-ongaku-images-account-one-v2',
      'anime-ongaku-next-audio-account-two-v1',
      'unrelated-cache-v1',
    ]
    for (const name of names) await storage.open(name)

    await sweepManagedMediaCaches({
      storage,
      namespace: 'account-one',
      version: 2,
    })

    expect([...storage.buckets.keys()]).toEqual([
      'anime-ongaku-next-audio-account-one-v2',
      'anime-ongaku-images-account-one-v2',
      'anime-ongaku-next-audio-account-two-v1',
      'unrelated-cache-v1',
    ])
  })
})
