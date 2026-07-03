const DEFAULT_QUIET_MS = 30_000;

/**
 * Tracks when a client last hit the media endpoints with a request the cache
 * could not serve (an on-demand miss). Background hydration consults this to
 * yield: MAINTENANCE fetch jobs are only claimed once on-demand traffic has
 * been quiet for `quietMs`, so warming the cache never competes with a client
 * that is actively waiting on media.
 */
export class InteractiveMediaActivity {
  private lastMissAt: number | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly quietMs: number = DEFAULT_QUIET_MS,
  ) {}

  markMiss(): void {
    this.lastMissAt = this.now();
  }

  isQuiet(): boolean {
    return this.lastMissAt === null || this.now() - this.lastMissAt >= this.quietMs;
  }
}
