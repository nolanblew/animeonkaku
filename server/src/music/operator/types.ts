import type { MusicBatchState } from "../requests/types.js";

export const MUSIC_OPERATOR_ACTIONS = ["RETRY_PROVIDER", "CANCEL_PROVIDER", "REPROCESS_PROVIDER"] as const;
export type MusicOperatorAction = typeof MUSIC_OPERATOR_ACTIONS[number];

export interface MusicOperatorBatchTarget {
  id: string;
  state: MusicBatchState;
  amfJobId: string | null;
  providerStatus: string | null;
  deliveryCount: number;
}

export interface MusicOperatorRepository {
  countRequests(): Promise<{ active: number; attention: number; failed: number }>;
  listRequests(): Promise<Array<Record<string, any>>>;
  findBatchTarget(batchId: string): Promise<MusicOperatorBatchTarget | null>;
  cleanupEligibility(batchId: string): Promise<{ exists: boolean; eligible: boolean; verifiedFileCount: number }>;
}

export interface MusicOperatorApiService {
  diagnostics(): Promise<Record<string, unknown>>;
  listRequests(): Promise<Array<Record<string, unknown>>>;
  enqueueAction(batchId: string, action: MusicOperatorAction): Promise<Record<string, unknown>>;
  cleanupEligibility(batchId: string): Promise<Record<string, unknown>>;
}
