export interface CacheBucket {
  keys(): Promise<readonly string[]>
  match(url: string): Promise<Response | undefined>
  put(url: string, response: Response): Promise<void>
  delete(url: string): Promise<boolean>
}

export interface CacheStoragePort {
  open(name: string): Promise<CacheBucket>
  delete(name: string): Promise<boolean>
}

export interface ManagedMediaCacheInput {
  imageUrls: readonly (string | null | undefined)[]
  nextAudioUrls: readonly (string | null | undefined)[]
}

export interface ManagedMediaCacheOptions {
  storage: CacheStoragePort
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  baseUrl?: string
  maxImageEntries?: number
  version?: number
}

/**
 * Owns small, versioned browser caches. Audio is strictly reconciled to the
 * next three unique queue entries; images use a bounded rolling cache.
 */
export class ManagedMediaCache {
  readonly audioCacheName: string
  readonly imageCacheName: string
  private readonly storage: CacheStoragePort
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  private readonly baseUrl: string
  private readonly maxImageEntries: number
  private operation: Promise<void> = Promise.resolve()

  constructor(options: ManagedMediaCacheOptions) {
    const version = Math.max(1, Math.trunc(options.version ?? 1))
    this.audioCacheName = `anime-ongaku-next-audio-v${version}`
    this.imageCacheName = `anime-ongaku-images-v${version}`
    this.storage = options.storage
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init))
    this.baseUrl = options.baseUrl ?? (typeof location === 'undefined' ? 'http://localhost/' : location.href)
    this.maxImageEntries = Math.max(1, Math.min(500, Math.trunc(options.maxImageEntries ?? 120)))
  }

  reconcile(input: ManagedMediaCacheInput): Promise<void> {
    return this.enqueue(() => this.reconcileLocked(input))
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await Promise.all([
        this.storage.delete(this.audioCacheName),
        this.storage.delete(this.imageCacheName),
      ])
    })
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.catch(() => undefined).then(operation)
    this.operation = next.catch(() => undefined)
    return next
  }

  private async reconcileLocked(input: ManagedMediaCacheInput): Promise<void> {
    const audioUrls = canonicalUrls(input.nextAudioUrls, this.baseUrl).slice(0, 3)
    const imageUrls = canonicalUrls(input.imageUrls, this.baseUrl).slice(0, this.maxImageEntries)
    const [audio, images] = await Promise.all([
      this.storage.open(this.audioCacheName),
      this.storage.open(this.imageCacheName),
    ])

    const desiredAudio = new Set(audioUrls)
    for (const cached of await audio.keys()) {
      if (!desiredAudio.has(cached)) await audio.delete(cached)
    }

    await Promise.all([
      ...audioUrls.map((url) => this.ensureCached(audio, url)),
      ...imageUrls.map((url) => this.ensureCached(images, url)),
    ])
    await this.pruneImages(images, new Set(imageUrls))
  }

  private async ensureCached(bucket: CacheBucket, url: string): Promise<void> {
    if (await bucket.match(url)) return
    try {
      const response = await this.fetcher(url, { credentials: 'include', cache: 'no-store' })
      if (!response.ok || response.type === 'opaque') return
      await bucket.put(url, response.clone())
    } catch {
      // Prefetch is opportunistic and must never interrupt playback or UI.
    }
  }

  private async pruneImages(bucket: CacheBucket, desired: ReadonlySet<string>): Promise<void> {
    const keys = [...await bucket.keys()]
    let overflow = keys.length - this.maxImageEntries
    if (overflow <= 0) return
    const evictionOrder = [
      ...keys.filter((url) => !desired.has(url)),
      ...keys.filter((url) => desired.has(url)),
    ]
    for (const url of evictionOrder) {
      if (overflow <= 0) break
      if (await bucket.delete(url)) overflow -= 1
    }
  }
}

export function browserCacheStorage(storage: CacheStorage = caches): CacheStoragePort {
  return {
    async open(name) {
      const cache = await storage.open(name)
      return {
        async keys() { return (await cache.keys()).map((request) => request.url) },
        async match(url) { return (await cache.match(url)) ?? undefined },
        async put(url, response) { await cache.put(url, response) },
        async delete(url) { return cache.delete(url) },
      }
    },
    async delete(name) { return storage.delete(name) },
  }
}

function canonicalUrls(values: readonly (string | null | undefined)[], baseUrl: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value?.trim()) continue
    try {
      const url = new URL(value, baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.hash = ''
      const canonical = url.href
      if (seen.has(canonical)) continue
      seen.add(canonical)
      result.push(canonical)
    } catch {
      // Ignore malformed/untrusted URLs.
    }
  }
  return result
}
