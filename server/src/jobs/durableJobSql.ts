import { sql } from "drizzle-orm";
import type { EnqueueJobInput } from "./types.js";

/** Shared by normal queue requests and the transactional sync outbox. */
export function durableJobInsert(input: EnqueueJobInput) {
  return sql`
    INSERT INTO jobs (type, priority, payload, dedupe_key, max_attempts, next_run_at)
    VALUES (${input.type}, ${input.priority}, ${JSON.stringify(input.payload)}::jsonb,
      ${input.dedupeKey ?? null}, ${input.maxAttempts}, ${input.nextRunAt})
    ON CONFLICT (dedupe_key) DO UPDATE SET
      type = CASE WHEN jobs.state IN ('DONE', 'CANCELLED') THEN EXCLUDED.type
        WHEN jobs.dedupe_key LIKE 'KITSU_SYNC:%' AND EXCLUDED.type = 'KITSU_FULL_SYNC'
        AND jobs.state IN ('QUEUED', 'FAILED') THEN 'KITSU_FULL_SYNC' ELSE jobs.type END,
      state = CASE WHEN jobs.state = 'FAILED' AND jobs.max_attempts < EXCLUDED.max_attempts THEN 'QUEUED'
        WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.state ELSE 'QUEUED' END,
      payload = CASE
        WHEN jobs.state = 'RUNNING' AND ${input.rerunIfRunning === true}
          THEN jobs.payload || jsonb_build_object('_rerunRequested', true, '_rerunPayload', EXCLUDED.payload)
        WHEN jobs.dedupe_key LIKE 'KITSU_SYNC:%' AND jobs.state IN ('QUEUED', 'FAILED')
          AND EXCLUDED.type = 'KITSU_FULL_SYNC' THEN CASE
            WHEN jobs.type = 'KITSU_FULL_SYNC' AND COALESCE(jobs.payload->>'reconcileOnly', 'false') = 'false'
              THEN jobs.payload ELSE EXCLUDED.payload END
        WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.payload
        ELSE EXCLUDED.payload END,
      priority = LEAST(jobs.priority, EXCLUDED.priority),
      max_attempts = GREATEST(jobs.max_attempts, EXCLUDED.max_attempts),
      attempts = CASE WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.attempts ELSE 0 END,
      progress = CASE WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.progress ELSE '{}'::jsonb END,
      last_error = CASE WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.last_error ELSE NULL END,
      next_run_at = CASE WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') THEN jobs.next_run_at ELSE EXCLUDED.next_run_at END,
      updated_at = CASE WHEN jobs.state IN ('RUNNING', 'QUEUED', 'FAILED') AND NOT ${input.rerunIfRunning === true}
        THEN jobs.updated_at ELSE now() END
    RETURNING *`;
}
