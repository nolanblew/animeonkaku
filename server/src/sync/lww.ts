/**
 * Last-write-wins conflict resolution.
 *
 * Every user mutation carries the client op-timestamp (`opTs`, epoch ms) of when the change was
 * made on the originating device. A write is applied to a field only if its op-timestamp is at
 * least as new as the stored field's version clock. This is what makes the system resilient to a
 * stalled write arriving after a newer one: the late, older write is rejected and the newer state
 * is kept.
 *
 * Ties (`opTs === storedTs`) favour the incoming write so a retried identical op is idempotent.
 *
 * Note: only *independent, overwriting* fields use LWW. Additive/commutative fields (play counts,
 * `greatest(lastPlayedAt)`) are conflict-free by construction and must not be gated by this.
 */
export function shouldApplyWrite(incomingTs: number, storedTs: number | null | undefined): boolean {
  if (storedTs === null || storedTs === undefined) return true;
  return incomingTs >= storedTs;
}

/**
 * Resolve the op-timestamp for an incoming write: an explicit client `opTs` when provided
 * (offline-first clients stamp the moment the user acted), otherwise the server's receive time.
 */
export function resolveOpTs(opTs: number | null | undefined, now: number): number {
  if (opTs === null || opTs === undefined) return now;
  if (!Number.isFinite(opTs) || opTs <= 0) return now;
  return opTs;
}
