import type { JobQueue } from "../jobs/jobQueue.js";
import { JobPriority } from "../jobs/types.js";
import { kitsuSyncDedupeKey } from "./syncJobKeys.js";

/** The slice of the authenticated user the trigger needs. */
export interface ActivityUser {
  kitsuUserId: string;
  lastSyncAt: Date | null;
  kitsuAuthState: string;
}

export interface DeviceActivitySyncOptions {
  queue: JobQueue;
  /** Enqueue a delta sync when the user's last sync is older than this. Default 3h. */
  staleAfterMs?: number;
  /** Per-user throttle so busy devices don't re-evaluate on every request. Default 15m. */
  checkCooldownMs?: number;
  now?: () => Date;
}

const DEFAULT_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const DEFAULT_CHECK_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * "The user might have just added something and opened the app" sync: any
 * authenticated API interaction from a device whose user hasn't synced in
 * ~3 hours enqueues a HIGH-priority delta sync (mirrors the old in-app
 * cold-start/warm-resume triggers, now server-owned). HIGH outranks the 24h
 * scheduler's NORMAL jobs, and the shared dedupe key upgrades an already
 * queued periodic delta instead of duplicating it. Completed syncs feed the
 * usual follow-ups (theme mapping, audio backfill).
 */
export class DeviceActivitySyncTrigger {
  private readonly queue: JobQueue;
  private readonly staleAfterMs: number;
  private readonly checkCooldownMs: number;
  private readonly now: () => Date;
  private readonly lastCheckedAtMs = new Map<string, number>();

  constructor(options: DeviceActivitySyncOptions) {
    this.queue = options.queue;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.checkCooldownMs = options.checkCooldownMs ?? DEFAULT_CHECK_COOLDOWN_MS;
    this.now = options.now ?? (() => new Date());
  }

  async onUserActivity(user: ActivityUser): Promise<void> {
    if (user.kitsuAuthState === "REAUTH_REQUIRED") return;
    // Never synced means the login-time FULL sync owns the first pass;
    // piling a delta on top of it would just burn Kitsu quota.
    if (!user.lastSyncAt) return;

    const nowMs = this.now().getTime();
    const lastChecked = this.lastCheckedAtMs.get(user.kitsuUserId);
    if (lastChecked !== undefined && nowMs - lastChecked < this.checkCooldownMs) return;
    this.lastCheckedAtMs.set(user.kitsuUserId, nowMs);

    if (nowMs - user.lastSyncAt.getTime() < this.staleAfterMs) return;

    await this.queue.enqueue({
      type: "KITSU_DELTA_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: user.kitsuUserId },
      dedupeKey: kitsuSyncDedupeKey(user.kitsuUserId),
    });
  }
}
