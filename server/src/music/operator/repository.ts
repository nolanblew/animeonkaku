import type { Pool } from "pg";
import type { MusicBatchState } from "../requests/types.js";
import type { MusicOperatorRepository } from "./types.js";

export class PgMusicOperatorRepository implements MusicOperatorRepository {
  constructor(private readonly pool: Pool) {}

  async countRequests() {
    const result = await this.pool.query<{ active: string; attention: string; failed: string }>(`SELECT
      count(*) FILTER (WHERE completed_at IS NULL) active,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM anime_music_request_batches b WHERE b.request_id=r.id AND b.state='AWAITING_OPERATOR')) attention,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM anime_music_request_batches b WHERE b.request_id=r.id AND b.state='FAILED')) failed
      FROM anime_music_requests r`);
    const row = result.rows[0]!;
    return { active: Number(row.active), attention: Number(row.attention), failed: Number(row.failed) };
  }

  async listRequests() {
    const result = await this.pool.query<any>(`SELECT r.id request_id,r.kitsu_id,r.created_at,r.updated_at,
      b.id batch_id,b.batch_index,b.state,b.warning_count,(b.amf_job_id IS NOT NULL) has_provider_job,
      count(i.id) FILTER (WHERE i.import_state='PENDING') item_pending,
      count(i.id) FILTER (WHERE i.import_state='READY') item_ready,
      count(i.id) FILTER (WHERE i.import_state='IMPORTING') item_importing,
      count(i.id) FILTER (WHERE i.import_state='ATTENTION') item_attention
      FROM anime_music_requests r JOIN anime_music_request_batches b ON b.request_id=r.id
      LEFT JOIN anime_music_request_items i ON i.batch_id=b.id
      GROUP BY r.id,b.id ORDER BY r.created_at DESC,b.batch_index LIMIT 1200`);
    const requests = new Map<string, any>();
    for (const row of result.rows) {
      let request = requests.get(row.request_id);
      if (!request) {
        request = { id: row.request_id, kitsuId: row.kitsu_id,
          createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), batches: [] };
        requests.set(row.request_id, request);
      }
      request.batches.push({ id: row.batch_id, index: row.batch_index, state: row.state,
        warningCount: row.warning_count, hasProviderJob: row.has_provider_job,
        itemCounts: { pending: Number(row.item_pending), importing: Number(row.item_importing), ready: Number(row.item_ready), attention: Number(row.item_attention) } });
    }
    for (const request of requests.values()) request.state = aggregate(request.batches.map((batch: any) => batch.state));
    return [...requests.values()].slice(0, 100);
  }

  async findBatchTarget(batchId: string) {
    const result = await this.pool.query<any>(`SELECT b.id,b.state,b.amf_job_id,b.manifest_evidence->>'status' provider_status,
      count(d.id) FILTER (WHERE d.active=true) delivery_count
      FROM anime_music_request_batches b LEFT JOIN anime_music_request_items i ON i.batch_id=b.id
      LEFT JOIN anime_music_request_deliveries d ON d.item_id=i.id WHERE b.id=$1 GROUP BY b.id`, [batchId]);
    const row = result.rows[0];
    return row ? { id: row.id, state: row.state as MusicBatchState, amfJobId: row.amf_job_id, providerStatus: row.provider_status,
      deliveryCount: Number(row.delivery_count) } : null;
  }

  async cleanupEligibility(batchId: string) {
    const result = await this.pool.query<any>(`SELECT b.id,count(d.id) FILTER (WHERE d.active=true) file_count,
      bool_and(d.import_state='READY' AND d.verified_byte_size IS NOT NULL AND d.verified_sha256 IS NOT NULL AND d.song_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM media_files m WHERE m.kind='AUDIO' AND m.ref_id=('song:' || d.song_id::text)
          AND m.variant='ORIGINAL' AND m.state='READY' AND m.byte_size=d.verified_byte_size AND m.sha256=d.verified_sha256))
        FILTER (WHERE d.active=true) verified
      FROM anime_music_request_batches b LEFT JOIN anime_music_request_items i ON i.batch_id=b.id
      LEFT JOIN anime_music_request_deliveries d ON d.item_id=i.id WHERE b.id=$1 GROUP BY b.id`, [batchId]);
    const row = result.rows[0];
    const count = row ? Number(row.file_count) : 0;
    return { exists: Boolean(row), eligible: count > 0 && row.verified === true, verifiedFileCount: count };
  }
}

function aggregate(states: MusicBatchState[]): MusicBatchState {
  for (const state of ["AWAITING_OPERATOR", "PROCESSING", "DOWNLOADING", "SEARCHING", "QUEUED"] as const)
    if (states.includes(state)) return state;
  if (states.every((state) => state === "CANCELLED")) return "CANCELLED";
  if (states.includes("FAILED")) return "FAILED";
  if (states.includes("CANCELLED") || states.includes("COMPLETED_WITH_WARNINGS")) return "COMPLETED_WITH_WARNINGS";
  return "COMPLETED";
}
