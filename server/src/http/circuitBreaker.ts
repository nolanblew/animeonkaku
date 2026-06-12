export interface CircuitBreakerOptions {
  threshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

type State = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Per-host breaker (doc 06): `threshold` consecutive failures open the
 * circuit for `cooldownMs`; after cooldown a single half-open probe is
 * allowed — success closes, failure re-opens with a fresh cooldown.
 */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private state: State = "CLOSED";
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
  }

  canRequest(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN") {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        this.probeInFlight = true;
        return true;
      }
      return false;
    }
    // HALF_OPEN: only the single in-flight probe may proceed
    if (!this.probeInFlight) {
      this.probeInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.open();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.open();
    }
  }

  private open(): void {
    this.state = "OPEN";
    this.openedAt = this.now();
    this.consecutiveFailures = 0;
    this.probeInFlight = false;
  }
}
