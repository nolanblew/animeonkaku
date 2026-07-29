import type { JobQueue } from "../../jobs/jobQueue.js";
import { JobPriority } from "../../jobs/types.js";
import { musicCatalogScanDedupeKey } from "./keys.js";

export class MusicDiscoveryScheduler {
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly queue: JobQueue,
    private readonly enabled: boolean,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}
  start(): void {
    if (!this.enabled || this.timer) return;
    this.enqueueObserved();
    this.timer = setInterval(() => this.enqueueObserved(), 24 * 60 * 60_000);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  async enqueueDailyScan(): Promise<void> {
    if (!this.enabled) return;
    await this.queue.enqueue({ type: "MUSIC_CATALOG_SCAN", priority: JobPriority.MAINTENANCE,
      dedupeKey: musicCatalogScanDedupeKey() });
  }
  private enqueueObserved(): void {
    void this.enqueueDailyScan().catch((error: unknown) => {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }
}
