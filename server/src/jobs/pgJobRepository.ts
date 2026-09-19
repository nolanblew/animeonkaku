import type pg from "pg";
import type { EnqueueJobInput, JobRecord, JobRepository, JobState, JobType, RetryJobInput } from "./types.js";

interface JobRow {
  id: number | string;
  type: string;
  priority: number;
  state: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  dedupe_key: string | null;
  attempts: number;
  max_attempts: number;
  next_run_at: Date;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PgJobRepository implements JobRepository {
  constructor(private readonly pool: pg.Pool) {}

  async markKitsuFullRefreshPending(dedupeKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE jobs
       SET payload = payload || '{"catalogRefreshPending":true}'::jsonb,
           updated_at = now()
       WHERE dedupe_key = $1
         AND state = 'RUNNING'
         AND (
           type = 'KITSU_DELTA_SYNC'
           OR (type = 'KITSU_FULL_SYNC' AND COALESCE(payload->>'reconcileOnly', 'false') = 'true')
         )
       RETURNING id`,
      [dedupeKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const result = await this.pool.query<JobRow>(
      `
        INSERT INTO jobs (type, priority, payload, dedupe_key, max_attempts, next_run_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
        ON CONFLICT (dedupe_key) DO UPDATE
          SET state = 'QUEUED',
              type = CASE
                WHEN jobs.dedupe_key LIKE 'KITSU_SYNC:%'
                  AND jobs.state IN ('QUEUED', 'FAILED')
                  AND (jobs.type = 'KITSU_FULL_SYNC' OR EXCLUDED.type = 'KITSU_FULL_SYNC')
                  THEN 'KITSU_FULL_SYNC'
                ELSE EXCLUDED.type
              END,
              priority = CASE
                WHEN jobs.state IN ('QUEUED', 'FAILED')
                  THEN LEAST(jobs.priority, EXCLUDED.priority)
                ELSE EXCLUDED.priority
              END,
              payload = CASE
                -- A periodic reconcile must never downgrade an explicit
                -- full/catalog refresh already waiting under the same key.
                WHEN jobs.dedupe_key LIKE 'KITSU_SYNC:%'
                  AND jobs.state IN ('QUEUED', 'FAILED')
                  AND jobs.type = 'KITSU_FULL_SYNC'
                  AND (
                    EXCLUDED.type = 'KITSU_DELTA_SYNC'
                    OR (
                      COALESCE(jobs.payload->>'reconcileOnly', 'false') = 'false'
                      AND COALESCE(EXCLUDED.payload->>'reconcileOnly', 'false') = 'true'
                    )
                  )
                  THEN jobs.payload
                ELSE EXCLUDED.payload
              END,
              max_attempts = EXCLUDED.max_attempts,
              attempts = 0,
              progress = '{}'::jsonb,
              last_error = NULL,
              next_run_at = LEAST(jobs.next_run_at, EXCLUDED.next_run_at),
              updated_at = now()
          WHERE jobs.state IN ('QUEUED', 'FAILED', 'DONE', 'CANCELLED')
        RETURNING *
      `,
      [
        input.type,
        input.priority,
        JSON.stringify(input.payload),
        input.dedupeKey,
        input.maxAttempts,
        input.nextRunAt,
      ],
    );
    const row = result.rows[0] ?? (await this.findJobRowByDedupeKey(input.dedupeKey));
    if (!row) throw new Error("Job enqueue failed without returning a row.");
    return toJobRecord(row);
  }

  async claimNext(now: Date, maxPriority?: number): Promise<JobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<JobRow>(
        `
          SELECT *
          FROM jobs
          WHERE state = 'QUEUED' AND next_run_at <= $1 AND priority <= $2
          ORDER BY priority, next_run_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        // priority is an int4 column — the no-ceiling default must fit in it.
        [now, maxPriority ?? 2_147_483_647],
      );
      const row = selected.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const updated = await client.query<JobRow>(
        "UPDATE jobs SET state = 'RUNNING', updated_at = now() WHERE id = $1 RETURNING *",
        [row.id],
      );
      await client.query("COMMIT");
      return toJobRecord(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(id: number): Promise<void> {
    await this.pool.query(
      `UPDATE jobs
       SET state = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN 'QUEUED'
             ELSE 'DONE'
           END,
           type = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN 'KITSU_FULL_SYNC'
             ELSE type
           END,
           payload = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN payload - 'reconcileOnly' - 'catalogRefreshPending'
             ELSE payload
           END,
           progress = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN '{}'::jsonb
             ELSE progress
           END,
           attempts = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN 0
             ELSE attempts
           END,
           next_run_at = CASE
             WHEN state = 'RUNNING' AND type IN ('KITSU_FULL_SYNC', 'KITSU_DELTA_SYNC')
               AND COALESCE(payload->>'catalogRefreshPending', 'false') = 'true'
               THEN now()
             ELSE next_run_at
           END,
           updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  async fail(id: number, input: RetryJobInput): Promise<JobRecord | null> {
    const result = await this.pool.query<JobRow>(
      `
        UPDATE jobs
        SET state = $2,
            attempts = attempts + $3,
            next_run_at = $4,
            last_error = $5,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, input.state, input.incrementAttempts ? 1 : 0, input.nextRunAt, input.lastError],
    );
    return result.rows[0] ? toJobRecord(result.rows[0]) : null;
  }

  async recoverRunning(): Promise<number> {
    const result = await this.pool.query(
      "UPDATE jobs SET state = 'QUEUED', updated_at = now() WHERE state = 'RUNNING'",
    );
    return result.rowCount ?? 0;
  }

  async list(status?: JobState, limit = 250): Promise<JobRecord[]> {
    const result = status
      ? await this.pool.query<JobRow>(
          "SELECT * FROM jobs WHERE state = $1 ORDER BY id DESC LIMIT $2",
          [status, limit],
        )
      : await this.pool.query<JobRow>("SELECT * FROM jobs ORDER BY id DESC LIMIT $1", [limit]);
    return result.rows.map(toJobRecord);
  }

  async listForUser(userId: string, types: readonly JobType[], limit: number): Promise<JobRecord[]> {
    if (types.length === 0) return [];
    const result = await this.pool.query<JobRow>(
      `SELECT * FROM jobs
       WHERE payload->>'userId' = $1 AND type = ANY($2::text[])
       ORDER BY id DESC LIMIT $3`,
      [userId, types, limit],
    );
    return result.rows.map(toJobRecord);
  }

  async pruneTerminalJobs(olderThan: Date, limit: number): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM jobs
       WHERE id IN (
         SELECT id FROM jobs
         WHERE state IN ('DONE', 'CANCELLED') AND updated_at < $1
         ORDER BY updated_at, id
         LIMIT $2
       )`,
      [olderThan, limit],
    );
    return result.rowCount ?? 0;
  }

  async retry(id: number, now: Date): Promise<JobRecord | null> {
    const result = await this.pool.query<JobRow>(
      `
        UPDATE jobs
        SET state = 'QUEUED',
            next_run_at = $2,
            last_error = NULL,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [id, now],
    );
    return result.rows[0] ? toJobRecord(result.rows[0]) : null;
  }

  async updateProgress(id: number, progress: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET progress = $2::jsonb, updated_at = now() WHERE id = $1",
      [id, JSON.stringify(progress)],
    );
  }

  async hasQueuedPriorityAtOrBelow(priority: number): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM jobs WHERE state = 'QUEUED' AND priority <= $1) AS exists",
      [priority],
    );
    return result.rows[0]?.exists ?? false;
  }

  async findByDedupeKey(dedupeKey: string): Promise<JobRecord | null> {
    const row = await this.findJobRowByDedupeKey(dedupeKey);
    return row ? toJobRecord(row) : null;
  }

  private async findJobRowByDedupeKey(dedupeKey: string | null | undefined): Promise<JobRow | null> {
    if (!dedupeKey) return null;
    const result = await this.pool.query<JobRow>("SELECT * FROM jobs WHERE dedupe_key = $1 LIMIT 1", [
      dedupeKey,
    ]);
    return result.rows[0] ?? null;
  }
}

function toJobRecord(row: JobRow): JobRecord {
  return {
    id: Number(row.id),
    type: row.type as JobRecord["type"],
    priority: row.priority,
    state: row.state as JobRecord["state"],
    payload: row.payload ?? {},
    progress: row.progress ?? {},
    dedupeKey: row.dedupe_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

