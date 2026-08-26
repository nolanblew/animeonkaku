import { describe, expect, it, vi } from 'vitest'
import { ManagedMediaCache, type CacheBucket, type CacheStoragePort } from './managedCache'

class FakeBucket implements CacheBucket {
  readonly entries = new Map<string, Response>()
  async keys() { return [...this.entries.keys()] }
  async match(url: string) { return this.entries.get(url) }
  async put(url: string, response: Response) { this.entries.set(url, response) }
  async delete(url: string) { return this.entries.delete(url) }
}

class FakeStorage implements CacheStoragePort {
  readonly buckets = new Map<string, FakeBucket>()
  async open(name: string) {
    let bucket = this.buckets.get(name)
    if (!bucket) {
      bucket = new FakeBucket()
      this.buckets.set(name, bucket)
    }
    return bucket
  }
  async delete(name: string) { return this.buckets.delete(name) }
}

describe('ManagedMediaCache', () => {
  it('keeps exactly the first three unique upcoming audio URLs', async () => {
    const storage = new FakeStorage()
    const fetcher = vi.fn(async (url: string) => new Response(url, { status: 200 }))
    const cache = new ManagedMediaCache({ storage, fetcher, baseUrl: 'https://ongaku.test/' })

    await cache.reconcile({ imageUrls: [], nextAudioUrls: ['/a', '/b', '/b', '/c', '/d'] })
    await cache.reconcile({ imageUrls: [], nextAudioUrls: ['/c', '/d'] })

    expect([...storage.buckets.get(cache.audioCacheName)!.entries.keys()]).toEqual([
      'https://ongaku.test/c',
      'https://ongaku.test/d',
    ])
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://ongaku.test/a',
      'https://ongaku.test/b',
      'https://ongaku.test/c',
      'https://ongaku.test/d',
    ])
  })

  it('retains image entries up to a bounded cap and evicts old non-visible images first', async () => {
    const storage = new FakeStorage()
    const cache = new ManagedMediaCache({
      storage,
      fetcher: async (url) => new Response(url, { status: 200 }),
      baseUrl: 'https://ongaku.test/',
      maxImageEntries: 3,
    })

    await cache.reconcile({ imageUrls: ['/1.jpg', '/2.jpg', '/3.jpg'], nextAudioUrls: [] })
    await cache.reconcile({ imageUrls: ['/3.jpg', '/4.jpg'], nextAudioUrls: [] })

    expect([...storage.buckets.get(cache.imageCacheName)!.entries.keys()]).toEqual([
      'https://ongaku.test/2.jpg',
      'https://ongaku.test/3.jpg',
      'https://ongaku.test/4.jpg',
    ])
  })

  it('ignores unsupported URLs and failed responses, and can clear owned caches', async () => {
    const storage = new FakeStorage()
    const cache = new ManagedMediaCache({
      storage,
      fetcher: async (url) => new Response('', { status: url.includes('bad') ? 500 : 200 }),
      baseUrl: 'https://ongaku.test/',
    })

    await cache.reconcile({ imageUrls: ['javascript:alert(1)', '/bad.jpg'], nextAudioUrls: ['data:text/plain,no'] })
    expect(storage.buckets.get(cache.imageCacheName)?.entries.size).toBe(0)
    expect(storage.buckets.get(cache.audioCacheName)?.entries.size).toBe(0)

    await cache.clear()
    expect(storage.buckets.size).toBe(0)
  })

  it('serializes rapid queue changes so the latest next-three set wins', async () => {
    const storage = new FakeStorage()
    const cache = new ManagedMediaCache({
      storage,
      fetcher: async (url) => new Response(url, { status: 200 }),
      baseUrl: 'https://ongaku.test/',
    })

    await Promise.all([
      cache.reconcile({ imageUrls: [], nextAudioUrls: ['/old-1', '/old-2', '/old-3'] }),
      cache.reconcile({ imageUrls: [], nextAudioUrls: ['/new-1', '/new-2'] }),
    ])

    expect([...storage.buckets.get(cache.audioCacheName)!.entries.keys()]).toEqual([
      'https://ongaku.test/new-1',
      'https://ongaku.test/new-2',
    ])
  })

  it('reads playback media only from its session-owned audio bucket', async () => {
    const storage = new FakeStorage()
    const first = new ManagedMediaCache({
      storage,
      namespace: 'account-one',
      fetcher: async (url) => new Response(`first:${url}`, { status: 200 }),
      baseUrl: 'https://ongaku.test/',
    })
    const second = new ManagedMediaCache({
      storage,
      namespace: 'account-two',
      fetcher: async (url) => new Response(`second:${url}`, { status: 200 }),
      baseUrl: 'https://ongaku.test/',
    })

    await first.reconcile({ imageUrls: [], nextAudioUrls: ['/next-song'] })

    expect(first.audioCacheName).not.toBe(second.audioCacheName)
    expect(await (await first.matchAudio('/next-song'))?.text()).toContain('first:')
    expect(await second.matchAudio('/next-song')).toBeUndefined()
  })
})
