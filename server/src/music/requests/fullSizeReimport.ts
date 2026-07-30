import { RetryableJobError, type JobHandler } from "../../jobs/index.js";
import { rm } from "node:fs/promises";
import type { Pool } from "pg";
import { resolveManagedMediaPath } from "../../media/mediaPathSafety.js";
import type { MusicRequestSummary } from "./types.js";

const RECHECK_MS = 10_000;

interface FullSizeReimportRequests {
  startFullSizeReimport(userId: string, kitsuId: string, requestId: string): Promise<Pick<MusicRequestSummary, "state">>;
}

export interface FullSizeReimportCleanup {
  finalize(requestId: string, kitsuId: string): Promise<Record<string, unknown>>;
}

export class PgFullSizeReimportCleanup implements FullSizeReimportCleanup {
  constructor(private readonly pool: Pool, private readonly mediaRoot: string) {}

  async finalize(requestId: string, kitsuId: string) {
    const client = await this.pool.connect();
    let pending: Array<{ id: number; filePath: string; songId: number }> = [];
    try {
      await client.query("BEGIN");
      const target = await client.query<{ animethemes_anime_id: string | number }>(`SELECT r.animethemes_anime_id
        FROM anime_music_requests r
        WHERE r.id=$1 AND r.kitsu_id=$2 AND r.source='ADMIN_REIMPORT' AND r.completed_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM anime_music_request_batches b WHERE b.request_id=r.id AND b.state<>'COMPLETED')
        FOR UPDATE`, [requestId, kitsuId]);
      if (!target.rows[0]) throw new Error("Full-size re-import snapshot is not completely verified.");
      const animeId = Number(target.rows[0].animethemes_anime_id);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`amf-full-size-reimport:${animeId}`]);
      const result = await client.query<{ id: string | number | null; file_path: string | null; song_id: string | number }>(`
        WITH current_deliveries AS (
          SELECT d.id,d.song_id,d.release_id
          FROM anime_music_request_deliveries d
          JOIN anime_music_request_items i ON i.id=d.item_id
          JOIN anime_music_request_batches b ON b.id=i.batch_id
          WHERE b.request_id=$1 AND i.kind IN ('OP','ED') AND d.active=true AND d.import_state='READY'
        ), detached AS (
          DELETE FROM theme_full_songs tf USING themes t
          WHERE t.id=tf.theme_id AND t.animethemes_anime_id=$3
            AND tf.evidence->>'source' = 'AMF'
            AND NOT EXISTS (SELECT 1 FROM current_deliveries d WHERE d.id=tf.evidence->>'deliveryId')
          RETURNING tf.song_id,tf.source_release_id
        ), obsolete_releases AS (
          SELECT DISTINCT d.release_id id
          FROM anime_music_request_deliveries d
          JOIN anime_music_request_items i ON i.id=d.item_id
          JOIN anime_music_request_batches b ON b.id=i.batch_id
          JOIN anime_music_requests r ON r.id=b.request_id
          JOIN music_releases mr ON mr.id=d.release_id AND mr.provider = 'AMF'
          WHERE r.animethemes_anime_id=$3 AND b.request_id<>$1 AND i.kind IN ('OP','ED')
            AND d.release_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM current_deliveries c WHERE c.release_id=d.release_id)
        ), removed_tracks AS (
          DELETE FROM release_tracks rt USING obsolete_releases old
          WHERE rt.release_id=old.id
            AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.source_release_id=rt.release_id)
            AND NOT EXISTS (SELECT 1 FROM anime_music_releases ar WHERE ar.release_id=rt.release_id)
          RETURNING rt.song_id
        ), pruned_releases AS (
          UPDATE music_releases mr SET deleted_at=now(),updated_at=now()
          FROM obsolete_releases old WHERE mr.id=old.id
            AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.source_release_id=mr.id)
            AND NOT EXISTS (SELECT 1 FROM anime_music_releases ar WHERE ar.release_id=mr.id)
          RETURNING mr.id
        ), candidate_songs AS (
          SELECT song_id FROM detached WHERE song_id IS NOT NULL
          UNION SELECT song_id FROM removed_tracks WHERE song_id IS NOT NULL
          UNION SELECT DISTINCT d.song_id
            FROM anime_music_request_deliveries d
            JOIN anime_music_request_items i ON i.id=d.item_id
            JOIN anime_music_request_batches b ON b.id=i.batch_id
            JOIN anime_music_requests r ON r.id=b.request_id
            WHERE r.animethemes_anime_id=$3 AND b.request_id<>$1 AND i.kind IN ('OP','ED') AND d.song_id IS NOT NULL
        ), orphan_songs AS (
          UPDATE songs s SET deleted_at=now(),updated_at=now()
          FROM candidate_songs c WHERE s.id=c.song_id
            AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.song_id=s.id)
            AND NOT EXISTS (SELECT 1 FROM release_tracks rt WHERE rt.song_id=s.id)
          RETURNING s.id
        ), pending_media AS (
          UPDATE media_files m SET state='DELETE_PENDING',error_message=NULL,updated_at=now()
          FROM orphan_songs s WHERE m.kind='AUDIO' AND m.variant='ORIGINAL'
            AND m.ref_id=('song:'||s.id::text) AND m.file_path IS NOT NULL
          RETURNING m.id,m.file_path,m.ref_id
        )
        SELECT m.id,m.file_path,s.id song_id FROM orphan_songs s
        LEFT JOIN pending_media m ON m.ref_id=('song:'||s.id::text)`, [requestId, kitsuId, animeId]);
      pending = result.rows
        .filter((row): row is typeof row & { id: string | number; file_path: string } => row.id !== null && row.file_path !== null)
        .map((row) => ({ id: Number(row.id), filePath: row.file_path, songId: Number(row.song_id) }));
      await client.query("COMMIT");
      const prunedSongs = new Set(result.rows.map((row) => Number(row.song_id))).size;
      for (const media of pending) {
        const path = await resolveManagedMediaPath(this.mediaRoot, media.filePath);
        await rm(path, { force: true });
        await this.pool.query(`UPDATE media_files SET state='MISSING',file_path=NULL,byte_size=NULL,sha256=NULL,
          error_message=NULL,updated_at=now() WHERE id=$1 AND state='DELETE_PENDING'`, [media.id]);
      }
      return { prunedSongs, prunedFiles: pending.length };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createFullSizeReimportHandlers(deps: {
  requests: FullSizeReimportRequests;
  cleanup: FullSizeReimportCleanup;
}): { REIMPORT_AMF_FULL_SIZE: JobHandler } {
  return {
    async REIMPORT_AMF_FULL_SIZE(payload, _job) {
      const kitsuId = requiredText(payload.kitsuId, "kitsuId");
      const userId = requiredText(payload.userId, "userId");
      const requestId = requiredText(payload.requestId, "requestId");
      const request = await deps.requests.startFullSizeReimport(userId, kitsuId, requestId);
      if (["QUEUED", "SEARCHING", "AWAITING_OPERATOR", "DOWNLOADING", "PROCESSING"].includes(request.state)) {
        throw new RetryableJobError("Fresh full-size snapshot is still importing", {
          incrementAttempts: false,
          retryAfterMs: RECHECK_MS,
          recordError: false,
        });
      }
      if (request.state === "COMPLETED") await deps.cleanup.finalize(requestId, kitsuId);
      // Warning/failed/cancelled snapshots deliberately retain the old catalog.
    },
  };
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Full-size re-import ${name} is required`);
  return value;
}
