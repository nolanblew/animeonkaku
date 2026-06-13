import type pg from "pg";
import type { EnqueueJobInput, JobRecord, JobRepository, JobState, RetryJobInput } from "./types.js";

interface JobRow {
  id: number | string;
  type: string;
  priority: number;
  state: string;
  payload: Record<string, unknown>;
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

  async enqueue(input: EnqueueJobInput): Promise<JobRecord> {
    const result = await this.pool.query<JobRow>(
      `
        INSERT INTO jobs (type, priority, payload, dedupe_key, max_attempts, next_run_at)
        VALUES ($1, $2, $3::jsonb, $4, $5, $6)
        ON CONFLICT (dedupe_key) DO UPDATE
          SET priority = LEAST(jobs.priority, EXCLUDED.priority),
              payload = EXCLUDED.payload,
              max_attempts = EXCLUDED.max_attempts,
              next_run_at = LEAST(jobs.next_run_at, EXCLUDED.next_run_at),
              updated_at = now()
          WHERE jobs.state IN ('QUEUED', 'FAILED')
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
    const row = result.rows[0] ?? (await this.findByDedupeKey(input.dedupeKey));
    if (!row) throw new Error("Job enqueue failed without returning a row.");
    return toJobRecord(row);
  }

  async claimNext(now: Date): Promise<JobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<JobRow>(
        `
          SELECT *
          FROM jobs
          WHERE state = 'QUEUED' AND next_run_at <= $1
          ORDER BY priority, next_run_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `,
        [now],
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
    await this.pool.query("UPDATE jobs SET state = 'DONE', updated_at = now() WHERE id = $1", [id]);
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

  async list(status?: JobState): Promise<JobRecord[]> {
    const result = status
      ? await this.pool.query<JobRow>(
          "SELECT * FROM jobs WHERE state = $1 ORDER BY id",
          [status],
        )
      : await this.pool.query<JobRow>("SELECT * FROM jobs ORDER BY id");
    return result.rows.map(toJobRecord);
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

  private async findByDedupeKey(dedupeKey: string | null | undefined): Promise<JobRow | null> {
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
    dedupeKey: row.dedupe_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRunAt: row.next_run_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

