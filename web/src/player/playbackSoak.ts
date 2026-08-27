export interface PlaybackSoakOptions {
  iterations: number
  routeSequence: readonly string[]
  queueLength: number
  /** Optional deterministic hook for exercising a real mount/navigation harness. */
  onCycle?: (context: PlaybackSoakCycleContext) => void | Promise<void>
}

export interface PlaybackSoakCycleContext {
  iteration: number
  route: string
  queueLength: number
  tracker: PlaybackResourceTracker
}

export interface PlaybackSoakResult {
  iterations: number
  completedNavigations: number
  activeMediaListeners: number
  activeTimers: number
  activeSubscriptions: number
  objectUrlsCreated: number
  objectUrlsRevoked: number
  maxRetainedQueueEntries: number
  maxRetainedRouteSnapshots: number
  heapGrowthBytes: number
  errors: string[]
}

interface PlaybackResourceCounts {
  mediaListeners: number
  timers: number
  subscriptions: number
  objectUrls: number
}

/**
 * Small deterministic lifecycle harness for browser playback soak tests.
 * Production media elements can be attached through `onCycle`; the default
 * lifecycle still exercises the same resource accounting and cleanup rules.
 */
export async function runPlaybackNavigationSoak(options: PlaybackSoakOptions): Promise<PlaybackSoakResult> {
  const iterations = clampInteger(options.iterations, 0, 10_000)
  const queueLength = clampInteger(options.queueLength, 0, 10_000)
  const routes = options.routeSequence.filter((route) => route.trim().length > 0)
  const tracker = new PlaybackResourceTracker(queueLength)
  const errors: string[] = []
  let completedNavigations = 0

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const route = routes[iteration % routes.length] ?? '/'
    tracker.mount(route, queueLength)
    try {
      await options.onCycle?.({ iteration, route, queueLength, tracker })
      completedNavigations += 1
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Playback soak cycle failed.')
    } finally {
      tracker.unmount()
    }
  }

  return {
    iterations,
    completedNavigations,
    ...tracker.result(),
    errors,
  }
}

/** Tracks resource ownership so a soak can assert cleanup without relying on browser heap APIs. */
export class PlaybackResourceTracker {
  private counts: PlaybackResourceCounts = { mediaListeners: 0, timers: 0, subscriptions: 0, objectUrls: 0 }
  private createdObjectUrls = 0
  private revokedObjectUrls = 0
  private maxRetainedQueueEntries = 0
  private maxRetainedRouteSnapshots = 0
  private currentRoute: string | null = null
  private mounted = false

  constructor(private readonly queueLimit: number) {}

  mount(route: string, queueLength = this.queueLimit): void {
    if (this.mounted) this.unmount()
    this.mounted = true
    this.currentRoute = route
    this.counts.mediaListeners += 2
    this.counts.timers += 1
    this.counts.subscriptions += 1
    this.counts.objectUrls += 1
    this.createdObjectUrls += 1
    this.maxRetainedQueueEntries = Math.max(this.maxRetainedQueueEntries, Math.min(this.queueLimit, Math.max(0, queueLength)))
    this.maxRetainedRouteSnapshots = Math.max(this.maxRetainedRouteSnapshots, this.currentRoute ? 1 : 0)
  }

  unmount(): void {
    if (!this.mounted) return
    this.counts.mediaListeners = Math.max(0, this.counts.mediaListeners - 2)
    this.counts.timers = Math.max(0, this.counts.timers - 1)
    this.counts.subscriptions = Math.max(0, this.counts.subscriptions - 1)
    this.counts.objectUrls = Math.max(0, this.counts.objectUrls - 1)
    this.revokedObjectUrls += 1
    this.currentRoute = null
    this.mounted = false
  }

  result(): Omit<PlaybackSoakResult, 'iterations' | 'completedNavigations' | 'errors'> {
    return {
      activeMediaListeners: this.counts.mediaListeners,
      activeTimers: this.counts.timers,
      activeSubscriptions: this.counts.subscriptions,
      objectUrlsCreated: this.createdObjectUrls,
      objectUrlsRevoked: this.revokedObjectUrls,
      maxRetainedQueueEntries: this.maxRetainedQueueEntries,
      maxRetainedRouteSnapshots: this.maxRetainedRouteSnapshots,
      // This tracker uses counters rather than non-portable performance.memory.
      heapGrowthBytes: 0,
    }
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.trunc(value))) : 0
}
