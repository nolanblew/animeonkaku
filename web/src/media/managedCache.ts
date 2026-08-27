export interface CacheBucket {
  keys(): Promise<readonly string[]>
  match(url: string): Promise<Response | undefined>
  put(url: string, response: Response): Promise<void>
  delete(url: string): Promise<boolean>
}

export interface CacheStoragePort {
  open(name: string): Promise<CacheBucket>
  delete(name: string): Promise<boolean>
  /** Cache Storage exposes this in browsers; adapters may omit it when sweeping is unavailable. */
  keys?(): Promise<readonly string[]>
}

export interface ManagedMediaCacheInput {
  imageUrls: readonly (string | null | undefined)[]
  nextAudioUrls: readonly (string | null | undefined)[]
}

export interface ManagedMediaCacheOptions {
  storage: CacheStoragePort
  /** Stable account identity used when no explicit namespace is supplied. */
  userId?: string
  namespace?: string
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
  readonly namespace: string
  readonly version: number
  private readonly storage: CacheStoragePort
  private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>
  private readonly baseUrl: string
  private readonly maxImageEntries: number
  private operation: Promise<void> = Promise.resolve()

  constructor(options: ManagedMediaCacheOptions) {
    const version = Math.max(1, Math.trunc(options.version ?? 1))
    const namespace = sanitizeNamespace(options.namespace ?? stableMediaCacheNamespace(options.userId))
    this.namespace = namespace
    this.version = version
    const suffix = namespace ? `-${namespace}` : ''
    this.audioCacheName = `anime-ongaku-next-audio${suffix}-v${version}`
    this.imageCacheName = `anime-ongaku-images${suffix}-v${version}`
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
      await sweepManagedMediaCaches({
        storage: this.storage,
        namespace: this.namespace,
        version: this.version,
      })
    })
  }

  sweep(): Promise<void> {
    return this.enqueue(() => sweepManagedMediaCaches({
      storage: this.storage,
      namespace: this.namespace,
      version: this.version,
    }))
  }

  async matchAudio(url: string): Promise<Response | undefined> {
    await this.operation.catch(() => undefined)
    const [canonical] = canonicalUrls([url], this.baseUrl)
    if (!canonical) return undefined
    const audio = await this.storage.open(this.audioCacheName)
    return audio.match(canonical)
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

function sanitizeNamespace(value: string | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) ?? ''
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
    async keys() { return storage.keys() },
  }
}

export interface ManagedMediaCacheSweepOptions {
  storage: CacheStoragePort
  namespace?: string
  version?: number
}

/**
 * Deletes only stale Anime Ongaku buckets owned by the supplied namespace.
 * Unknown cache names and current-version buckets are intentionally preserved.
 */
export async function sweepManagedMediaCaches(options: ManagedMediaCacheSweepOptions): Promise<void> {
  const list = options.storage.keys
  if (!list) return
  const names = await list.call(options.storage)
  const namespace = sanitizeNamespace(options.namespace)
  const version = Math.max(1, Math.trunc(options.version ?? 1))
  const suffix = namespace ? `-${namespace}` : ''
  const current = new Set([
    `anime-ongaku-next-audio${suffix}-v${version}`,
    `anime-ongaku-images${suffix}-v${version}`,
  ])
  const prefixes = [
    `anime-ongaku-next-audio${suffix}-v`,
    `anime-ongaku-images${suffix}-v`,
  ]
  const stale = names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)) && /-v\d+$/.test(name) && !current.has(name))
  await Promise.all(stale.map((name) => options.storage.delete(name)))
}

/**
 * Produces a stable, non-identifying namespace for one account. A hash keeps
 * emails/user IDs out of Cache Storage names while preventing cross-account
 * cache reuse.
 */
export function stableMediaCacheNamespace(userId?: string): string {
  const normalized = userId?.trim().toLowerCase()
  if (!normalized) return 'anonymous'
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `u${(hash >>> 0).toString(36)}`
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
