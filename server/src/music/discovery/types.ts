import type { JobRecord } from "../../jobs/types.js";

export const RECENT_ANIME_WINDOW_MS = 365 * 24 * 60 * 60_000;
export const RECENT_SCAN_INTERVAL_MS = 7 * 24 * 60 * 60_000;
export const MISSING_FULL_SCAN_INTERVAL_MS = 30 * 24 * 60 * 60_000;
export const DISCOVERY_DAILY_LIMIT = 25;
export const ACQUISITION_POLL_INTERVAL_MS = 5 * 60_000;

export interface MusicDiscoveryStateRecord {
  animethemesAnimeId: number;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextScanAt: Date | null;
  status: "NEVER" | "DUE" | "RUNNING" | "COMPLETE" | "FAILED";
  missingFullCount: number;
  failureCount: number;
  lastError: string | null;
}

export interface DiscoveryCompletion {
  missingFullCount: number;
  ambiguous: boolean;
}

export interface MusicDiscoveryRepository {
  ensureAnime(animeIds: number[], now: Date): Promise<number[]>;
  listMappedAnimeIds(): Promise<number[]>;
  listDue(now: Date, limit: number): Promise<MusicDiscoveryStateRecord[]>;
  markRunning(animeId: number, now: Date): Promise<void>;
  markSucceeded(animeId: number, result: DiscoveryCompletion, now: Date): Promise<void>;
  markFailed(animeId: number, error: string, now: Date): Promise<void>;
  recoverStaleRunning(now: Date): Promise<number>;
}

export interface MusicDiscoveryWorkflow {
  discoverAnime(input: { animeId: number; job: JobRecord }): Promise<DiscoveryCompletion>;
  reconcileAcquisition(input: { acquisitionId: number; job: JobRecord }): Promise<"PENDING" | "COMPLETE">;
}
