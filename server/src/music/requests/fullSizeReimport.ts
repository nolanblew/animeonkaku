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
      await client.query(`DELETE FROM theme_full_songs tf USING themes t
        WHERE t.id=tf.theme_id AND t.animethemes_anime_id=$2
          AND tf.evidence->>'source' = 'AMF'
          AND NOT EXISTS (
            SELECT 1 FROM anime_music_request_deliveries d
            JOIN anime_music_request_items i ON i.id=d.item_id
            JOIN anime_music_request_batches b ON b.id=i.batch_id
            WHERE b.request_id=$1 AND i.kind IN ('OP','ED') AND d.active=true AND d.import_state='READY'
              AND d.id=tf.evidence->>'deliveryId'
          )`, [requestId, animeId]);
      const obsolete = await client.query<{ id: string | number }>(`SELECT DISTINCT d.release_id id
        FROM anime_music_request_deliveries d
        JOIN anime_music_request_items i ON i.id=d.item_id
        JOIN anime_music_request_batches b ON b.id=i.batch_id
        JOIN anime_music_requests r ON r.id=b.request_id
        JOIN music_releases mr ON mr.id=d.release_id AND mr.provider = 'AMF'
        WHERE r.animethemes_anime_id=$2 AND b.request_id<>$1 AND i.kind IN ('OP','ED')
          AND d.release_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM anime_music_request_deliveries current_d
            JOIN anime_music_request_items current_i ON current_i.id=current_d.item_id
            JOIN anime_music_request_batches current_b ON current_b.id=current_i.batch_id
            WHERE current_b.request_id=$1 AND current_d.release_id=d.release_id
          )`, [requestId, animeId]);
      const releaseIds = obsolete.rows.map((row) => Number(row.id));
      if (releaseIds.length > 0) {
        await client.query(`DELETE FROM release_tracks rt WHERE rt.release_id=ANY($1::bigint[])
          AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.source_release_id=rt.release_id)
          AND NOT EXISTS (SELECT 1 FROM anime_music_releases ar WHERE ar.release_id=rt.release_id)`, [releaseIds]);
        await client.query(`UPDATE music_releases mr SET deleted_at=now(),updated_at=now()
          WHERE mr.id=ANY($1::bigint[])
            AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.source_release_id=mr.id)
            AND NOT EXISTS (SELECT 1 FROM anime_music_releases ar WHERE ar.release_id=mr.id)`, [releaseIds]);
      }
      const orphaned = await client.query<{ id: string | number }>(`UPDATE songs s SET deleted_at=now(),updated_at=now()
        WHERE EXISTS (
          SELECT 1 FROM anime_music_request_deliveries d
          JOIN anime_music_request_items i ON i.id=d.item_id
          JOIN anime_music_request_batches b ON b.id=i.batch_id
          JOIN anime_music_requests r ON r.id=b.request_id
          WHERE r.animethemes_anime_id=$2 AND b.request_id<>$1 AND i.kind IN ('OP','ED') AND d.song_id=s.id
        )
          AND NOT EXISTS (SELECT 1 FROM theme_full_songs tf WHERE tf.song_id=s.id)
          AND NOT EXISTS (SELECT 1 FROM release_tracks rt WHERE rt.song_id=s.id)
        RETURNING s.id`, [requestId, animeId]);
      const orphanSongIds = orphaned.rows.map((row) => Number(row.id));
      if (orphanSongIds.length > 0) {
        const result = await client.query<{ id: string | number; file_path: string; song_id: string | number }>(`UPDATE media_files m
          SET state='DELETE_PENDING',error_message=NULL,updated_at=now()
          FROM unnest($1::bigint[]) AS orphan(song_id)
          WHERE m.kind='AUDIO' AND m.variant='ORIGINAL' AND m.ref_id=('song:'||orphan.song_id::text) AND m.file_path IS NOT NULL
          RETURNING m.id,m.file_path,orphan.song_id`, [orphanSongIds]);
        pending = result.rows.map((row) => ({ id: Number(row.id), filePath: row.file_path, songId: Number(row.song_id) }));
      }
      await client.query("COMMIT");
      const prunedSongs = orphanSongIds.length;
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
