import type { MusicSearchPolicyService } from "./service.js";

export const MUSIC_SEARCH_RECONCILE_INTERVAL_MS = 15 * 60_000;

export class MusicSearchPolicyScheduler {
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly service: Pick<MusicSearchPolicyService, "enqueueReconciliation">,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  start(): void {
    if (this.timer) return;
    this.enqueueObserved();
    this.timer = setInterval(() => this.enqueueObserved(), MUSIC_SEARCH_RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private enqueueObserved(): void {
    void this.service.enqueueReconciliation().catch((error: unknown) => {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }
}
