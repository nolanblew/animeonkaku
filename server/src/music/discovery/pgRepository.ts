import type pg from "pg";
import {
  MISSING_FULL_SCAN_INTERVAL_MS,
  RECENT_SCAN_INTERVAL_MS,
  type DiscoveryCompletion,
  type MusicDiscoveryRepository,
  type MusicDiscoveryStateRecord,
} from "./types.js";

interface DiscoveryRow {
  animethemes_anime_id: number | string;
  last_attempt_at: Date | null;
  last_success_at: Date | null;
  next_scan_at: Date | null;
  status: MusicDiscoveryStateRecord["status"];
  missing_full_count: number;
  failure_count: number;
  last_error: string | null;
}

export class PgMusicDiscoveryRepository implements MusicDiscoveryRepository {
  constructor(private readonly pool: pg.Pool) {}

  async ensureAnime(animeIds: number[], now: Date): Promise<number[]> {
    if (animeIds.length === 0) return [];
    const result = await this.pool.query<{ animethemes_anime_id: number | string }>(`
      INSERT INTO music_discovery_state (animethemes_anime_id, next_scan_at, status)
      SELECT DISTINCT anime_id, $2, 'DUE'
      FROM unnest($1::bigint[]) AS ids(anime_id)
      ON CONFLICT (animethemes_anime_id) DO NOTHING
      RETURNING animethemes_anime_id
    `, [animeIds, now]);
    return result.rows.map((row) => Number(row.animethemes_anime_id));
  }

  async listMappedAnimeIds(): Promise<number[]> {
    const result = await this.pool.query<{ animethemes_anime_id: number | string }>(`SELECT DISTINCT animethemes_anime_id
      FROM kitsu_anime mapped WHERE animethemes_anime_id IS NOT NULL AND deleted_at IS NULL AND mapping_state='MAPPED'
        AND EXISTS (SELECT 1 FROM themes t WHERE t.animethemes_anime_id=mapped.animethemes_anime_id
          AND t.deleted_at IS NULL AND t.animethemes_song_id IS NOT NULL)
      ORDER BY animethemes_anime_id`);
    return result.rows.map((row) => Number(row.animethemes_anime_id));
  }

  async listDue(now: Date, limit: number): Promise<MusicDiscoveryStateRecord[]> {
    const recentAfter = oneCalendarYearEarlier(now).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const result = await this.pool.query<DiscoveryRow>(`
      SELECT ds.*
      FROM music_discovery_state ds
      LEFT JOIN LATERAL (
        SELECT MAX(ka.start_date) AS release_date
        FROM kitsu_anime ka
        WHERE ka.animethemes_anime_id = ds.animethemes_anime_id AND ka.deleted_at IS NULL AND ka.mapping_state='MAPPED'
      ) release ON TRUE
      WHERE ds.status <> 'RUNNING'
        AND EXISTS (SELECT 1 FROM kitsu_anime mapped WHERE mapped.animethemes_anime_id=ds.animethemes_anime_id
          AND mapped.deleted_at IS NULL AND mapped.mapping_state='MAPPED')
        AND (ds.next_scan_at IS NULL OR ds.next_scan_at <= $1)
        AND (ds.status IN ('NEVER', 'DUE', 'FAILED')
          OR ds.missing_full_count > 0
          OR release.release_date BETWEEN $2::date AND $3::date)
      ORDER BY ds.next_scan_at NULLS FIRST, ds.last_attempt_at NULLS FIRST, ds.animethemes_anime_id
      LIMIT $4
    `, [now, recentAfter, today, limit]);
    return result.rows.map(toRecord);
  }

  async markRunning(animeId: number, now: Date): Promise<void> {
    await this.pool.query(`UPDATE music_discovery_state SET status='RUNNING', last_attempt_at=$2,
      last_error=NULL, updated_at=now() WHERE animethemes_anime_id=$1`, [animeId, now]);
  }

  async markSucceeded(animeId: number, result: DiscoveryCompletion, now: Date): Promise<void> {
    const recentAfter = oneCalendarYearEarlier(now).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    await this.pool.query(`UPDATE music_discovery_state ds SET status='COMPLETE', last_success_at=$2,
      next_scan_at=CASE WHEN EXISTS (SELECT 1 FROM kitsu_anime ka WHERE ka.animethemes_anime_id=$1
          AND ka.deleted_at IS NULL AND ka.mapping_state='MAPPED' AND ka.start_date BETWEEN $5::date AND $6::date) THEN $7::timestamptz
        WHEN $3 > 0 THEN $4::timestamptz ELSE NULL END,
      missing_full_count=$3, failure_count=0, last_error=NULL, updated_at=now()
      WHERE ds.animethemes_anime_id=$1`, [animeId, now, result.missingFullCount,
      new Date(now.getTime() + MISSING_FULL_SCAN_INTERVAL_MS), recentAfter, today,
      new Date(now.getTime() + RECENT_SCAN_INTERVAL_MS)]);
  }

  async markFailed(animeId: number, error: string, now: Date): Promise<void> {
    await this.pool.query(`UPDATE music_discovery_state SET status='FAILED', failure_count=failure_count+1,
      next_scan_at=$3, last_error=$2, updated_at=now() WHERE animethemes_anime_id=$1`,
    [animeId, error, new Date(now.getTime() + MISSING_FULL_SCAN_INTERVAL_MS)]);
  }

  async recoverStaleRunning(now: Date): Promise<number> {
    const result = await this.pool.query(`UPDATE music_discovery_state SET status='DUE',next_scan_at=$1,updated_at=now()
      WHERE status='RUNNING'`, [now]);
    return result.rowCount ?? 0;
  }
}

/** Closed calendar window required by the product schedule (not 365 elapsed days). */
export function oneCalendarYearEarlier(now: Date): Date {
  const year = now.getUTCFullYear() - 1;
  const month = now.getUTCMonth();
  const day = Math.min(now.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
}

function toRecord(row: DiscoveryRow): MusicDiscoveryStateRecord {
  return { animethemesAnimeId: Number(row.animethemes_anime_id), lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at, nextScanAt: row.next_scan_at, status: row.status,
    missingFullCount: row.missing_full_count, failureCount: row.failure_count, lastError: row.last_error };
}
