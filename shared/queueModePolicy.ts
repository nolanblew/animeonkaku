export type AudioQueueMode = 'TV_SIZE' | 'FULL_SIZE'
export type ThemeQueueMode = AudioQueueMode | 'VIDEO'

export interface QueueModeAvailability {
  readonly TV_SIZE: boolean
  readonly FULL_SIZE: boolean
  readonly VIDEO: boolean
}

export interface QueueModePolicyInput {
  /** Device-local desired mode for this queue; defaults to TV_SIZE. */
  readonly queueDesiredMode?: ThemeQueueMode | null | undefined
  /** Durable per-theme audio preference. */
  readonly savedPreferredAudioMode?: AudioQueueMode | null | undefined
  /** Effective soft action seed for this occurrence (playlist or queue action). */
  readonly softMode?: AudioQueueMode | null | undefined
  /** A strict occurrence may use only this audio mode or an explicitly desired Video. */
  readonly requiredAudioMode?: AudioQueueMode | null | undefined
  /** Explicit selection may override dislikes, but not availability or strict type. */
  readonly manualMode?: ThemeQueueMode | null | undefined
  readonly globallyDisliked?: boolean | undefined
  readonly dislikedTvSize?: boolean | undefined
  readonly dislikedFullSize?: boolean | undefined
  readonly allowDisliked?: boolean | undefined
  readonly available: QueueModeAvailability
}

export type QueueModeResolutionReason =
  | 'SELECTED'
  | 'FALLBACK'
  | 'GLOBAL_DISLIKE'
  | 'REQUIRED_UNAVAILABLE'
  | 'STRICT_MODE_REJECTED'
  | 'NO_ALLOWED_MODE'

export interface QueueModePolicyResult {
  readonly desiredMode: ThemeQueueMode
  readonly actualMode: ThemeQueueMode | null
  readonly reason: QueueModeResolutionReason
}

/** Stateless cross-client Theme mode policy. Queue history/action ordering stays player-owned. */
export function resolveQueueMode(input: QueueModePolicyInput): QueueModePolicyResult {
  const queueDesired = input.queueDesiredMode ?? 'TV_SIZE'
  const effectiveDesired: ThemeQueueMode = input.softMode ?? queueDesired
  const automaticDesired: ThemeQueueMode = effectiveDesired === 'VIDEO'
    ? 'VIDEO'
    : input.savedPreferredAudioMode ?? effectiveDesired
  const desiredMode = input.manualMode ?? automaticDesired
  const strict = input.requiredAudioMode ?? null
  const ignoreDislikes = input.allowDisliked === true || input.manualMode != null

  // Strict audio availability is an admission gate, including for explicit Video intent.
  if (strict && !input.available[strict]) {
    return { desiredMode, actualMode: null, reason: 'REQUIRED_UNAVAILABLE' }
  }
  if (!ignoreDislikes && input.globallyDisliked) {
    return { desiredMode, actualMode: null, reason: 'GLOBAL_DISLIKE' }
  }
  if (strict && desiredMode !== 'VIDEO' && desiredMode !== strict && input.manualMode != null) {
    return { desiredMode, actualMode: null, reason: 'STRICT_MODE_REJECTED' }
  }

  const allowed = (mode: ThemeQueueMode): boolean => {
    if (!input.available[mode]) return false
    if (strict && mode !== 'VIDEO' && mode !== strict) return false
    if (ignoreDislikes || mode === 'VIDEO') return true
    if (mode === 'TV_SIZE') return input.dislikedTvSize !== true
    if (mode === 'FULL_SIZE') return input.dislikedFullSize !== true
    return true
  }

  const candidates: readonly ThemeQueueMode[] = input.manualMode != null
    ? [input.manualMode]
    : strict
      ? desiredMode === 'VIDEO' ? ['VIDEO', strict] : [strict]
      : desiredMode === 'VIDEO'
        ? ['VIDEO', 'TV_SIZE']
        : desiredMode === 'FULL_SIZE'
          ? ['FULL_SIZE', 'TV_SIZE']
          : ['TV_SIZE', 'FULL_SIZE']
  const actualMode = candidates.find(allowed) ?? null
  return {
    desiredMode,
    actualMode,
    reason: actualMode == null ? 'NO_ALLOWED_MODE' : actualMode === desiredMode ? 'SELECTED' : 'FALLBACK',
  }
}
