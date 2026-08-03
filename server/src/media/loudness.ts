import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { mediaFiles } from "../db/schema.js";
import { JobPriority, type JobHandler, type JobQueue } from "../jobs/index.js";
import { resolveManagedMediaPath } from "./mediaPathSafety.js";
import type { LoudnessDescriptor, MediaDescriptor, MediaFileRecord } from "./types.js";

export const LOUDNESS_POLICY_VERSION = 1;
export const LOUDNESS_TARGET_LUFS = -16;
export const LOUDNESS_TRUE_PEAK_CEILING_DBTP = -1;

export function loudnessAnalysisDedupeKey(input: MediaDescriptor & { sha256: string }): string {
  return `ANALYZE_AUDIO_LOUDNESS:${input.kind}:${input.variant}:${input.refId}:${input.sha256}`;
}

export function playbackLoudness(record: {
  loudnessState?: string | null; loudnessSha256?: string | null; sha256?: string | null;
  integratedLufs?: number | null; truePeakDbtp?: number | null; loudnessRangeLu?: number | null;
  loudnessGainDb?: number | null; loudnessPolicyVersion?: number | null;
},
  enabled: boolean,
): LoudnessDescriptor | { state: "PENDING" | "FAILED" } | undefined {
  if (record.loudnessState === "READY" && record.loudnessSha256 === record.sha256
    && record.integratedLufs !== null && record.integratedLufs !== undefined
    && record.truePeakDbtp !== null && record.truePeakDbtp !== undefined
    && record.loudnessRangeLu !== null && record.loudnessRangeLu !== undefined
    && record.loudnessGainDb !== null && record.loudnessGainDb !== undefined
    && record.loudnessPolicyVersion !== null && record.loudnessPolicyVersion !== undefined) {
    return {
      integratedLufs: record.integratedLufs,
      truePeakDbtp: record.truePeakDbtp,
      loudnessRangeLu: record.loudnessRangeLu,
      gainDb: enabled ? record.loudnessGainDb : 0,
      policyVersion: record.loudnessPolicyVersion,
      state: "READY",
    };
  }
  return record.loudnessState === "PENDING" || record.loudnessState === "FAILED"
    ? { state: record.loudnessState } : undefined;
}

export interface LoudnessAnalyzer {
  analyze(filePath: string, signal?: AbortSignal): Promise<{ integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number }>;
}

/** Analysis-only FFmpeg invocation: the output is the null muxer, never a media file. */
export class FfmpegLoudnessAnalyzer implements LoudnessAnalyzer {
  constructor(private readonly executable = "ffmpeg") {}

  async analyze(filePath: string, signal?: AbortSignal): Promise<{ integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number }> {
    const args = ["-nostdin", "-nostats", "-hide_banner", "-v", "info", "-i", filePath,
      "-af", "loudnorm=I=-16:TP=-1:LRA=11:print_format=json", "-f", "null", "-"];
    const stderr = await runProcess(this.executable, args, signal);
    return parseFfmpegLoudnormOutput(stderr);
  }
}

export function parseFfmpegLoudnormOutput(stderr: string): { integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number } {
    const match = /\{\s*"input_i"[\s\S]*?\}/.exec(stderr);
    if (!match) throw new Error("FFmpeg loudnorm analysis produced no measurement JSON.");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(match[0]) as Record<string, unknown>; } catch { throw new Error("FFmpeg loudnorm analysis returned invalid JSON."); }
    const integratedLufs = numeric(parsed.input_i, "input_i");
    const truePeakDbtp = numeric(parsed.input_tp, "input_tp");
    const loudnessRangeLu = numeric(parsed.input_lra, "input_lra");
    return { integratedLufs, truePeakDbtp, loudnessRangeLu };
}

export class DrizzleLoudnessRepository {
  constructor(private readonly db: Db) {}

  async find(input: MediaDescriptor): Promise<MediaFileRecord | null> {
    const row = (await this.db.select().from(mediaFiles).where(and(
      eq(mediaFiles.kind, input.kind), eq(mediaFiles.refId, input.refId), eq(mediaFiles.variant, input.variant),
    )).limit(1))[0];
    return row ? toRecord(row) : null;
  }

  async markReady(id: number, sha256: string, values: { integratedLufs: number; truePeakDbtp: number; loudnessRangeLu: number; gainDb: number }): Promise<void> {
    await this.db.update(mediaFiles).set({
      loudnessState: "READY", loudnessSha256: sha256,
      integratedLufs: values.integratedLufs, truePeakDbtp: values.truePeakDbtp,
      loudnessRangeLu: values.loudnessRangeLu, loudnessGainDb: values.gainDb,
      loudnessPolicyVersion: LOUDNESS_POLICY_VERSION, loudnessError: null,
      loudnessAnalyzedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(mediaFiles.id, id), eq(mediaFiles.sha256, sha256), eq(mediaFiles.state, "READY")));
  }

  async markFailed(id: number, sha256: string, error: string): Promise<void> {
    await this.db.update(mediaFiles).set({
      loudnessState: "FAILED", loudnessSha256: sha256, loudnessError: error.slice(0, 2000),
      loudnessAnalyzedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(mediaFiles.id, id), eq(mediaFiles.sha256, sha256), eq(mediaFiles.state, "READY")));
  }

  async listBackfill(limit: number, ids?: number[]): Promise<MediaFileRecord[]> {
    const stale = or(
      isNull(mediaFiles.loudnessState),
      ne(mediaFiles.loudnessState, "READY"),
      isNull(mediaFiles.loudnessSha256),
      sql`${mediaFiles.loudnessSha256} IS DISTINCT FROM ${mediaFiles.sha256}`,
    )!;
    const rows = await this.db.select().from(mediaFiles).where(and(
      eq(mediaFiles.kind, "AUDIO"), eq(mediaFiles.state, "READY"), stale,
      ...(ids && ids.length > 0 ? [inArray(mediaFiles.id, ids)] : []),
    )).orderBy(mediaFiles.id).limit(limit);
    return rows.map(toRecord);
  }
}

export function createLoudnessHandlers(input: { repo: DrizzleLoudnessRepository; mediaRoot: string; analyzer?: LoudnessAnalyzer }): Record<"ANALYZE_AUDIO_LOUDNESS", JobHandler> {
  const analyzer = input.analyzer ?? new FfmpegLoudnessAnalyzer();
  return {
    ANALYZE_AUDIO_LOUDNESS: async (payload, _job, context) => {
      const descriptor = parseDescriptor(payload);
      const expectedSha = typeof payload.sha256 === "string" ? payload.sha256 : null;
      if (!expectedSha) throw new Error("Loudness analysis job is missing sha256.");
      const media = await input.repo.find(descriptor);
      if (!media || media.state !== "READY" || media.sha256 !== expectedSha || !media.filePath) return;
      const absolutePath = await resolveManagedMediaPath(resolve(input.mediaRoot), media.filePath);
      if (!(await stat(absolutePath).catch(() => null))?.isFile()) throw new Error("Ready media file is missing from storage.");
      try {
        const measured = await analyzer.analyze(absolutePath, context.signal);
        const gainDb = Math.min(0, LOUDNESS_TARGET_LUFS - measured.integratedLufs,
          LOUDNESS_TRUE_PEAK_CEILING_DBTP - measured.truePeakDbtp);
        await input.repo.markReady(media.id, expectedSha, { ...measured, gainDb: round(gainDb) });
      } catch (error) {
        await input.repo.markFailed(media.id, expectedSha, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}

export class LoudnessBackfillService {
  constructor(private readonly repo: DrizzleLoudnessRepository, private readonly queue: JobQueue) {}

  /** Queues a bounded sample (ids optional) or every stale READY audio row. Safe to repeat. */
  async enqueue(input: { limit: number; mediaFileIds?: number[]; priority?: number }): Promise<number> {
    const files = await this.repo.listBackfill(input.limit, input.mediaFileIds);
    for (const file of files) {
      if (!file.sha256) continue;
      await this.queue.enqueue({ type: "ANALYZE_AUDIO_LOUDNESS", priority: input.priority ?? JobPriority.MAINTENANCE,
        payload: { kind: file.kind, refId: file.refId, variant: file.variant, sha256: file.sha256 },
        dedupeKey: loudnessAnalysisDedupeKey({ ...file, sha256: file.sha256 }), maxAttempts: 3 });
    }
    return files.length;
  }
}

export async function enqueueLoudnessAnalysis(queue: JobQueue, media: MediaFileRecord): Promise<void> {
  if (media.kind !== "AUDIO" || media.state !== "READY" || !media.sha256) return;
  await queue.enqueue({ type: "ANALYZE_AUDIO_LOUDNESS", priority: JobPriority.MAINTENANCE,
    payload: { kind: media.kind, refId: media.refId, variant: media.variant, sha256: media.sha256 },
    dedupeKey: loudnessAnalysisDedupeKey({ ...media, sha256: media.sha256 }), maxAttempts: 3 });
}

function parseDescriptor(payload: Record<string, unknown>): MediaDescriptor {
  if ((payload.kind !== "AUDIO") || typeof payload.refId !== "string" ||
    !["SHORT", "ORIGINAL", "FULL", "DEFAULT"].includes(String(payload.variant))) throw new Error("Invalid loudness analysis descriptor.");
  return { kind: "AUDIO", refId: payload.refId, variant: payload.variant as MediaDescriptor["variant"] };
}

function numeric(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`FFmpeg loudnorm measurement ${name} is invalid.`);
  return round(parsed);
}
function round(value: number): number { return Math.round(value * 100) / 100; }

function runProcess(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    const abort = () => { child.kill("SIGKILL"); reject(new Error("FFmpeg loudness analysis aborted.")); };
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      code === 0 ? resolvePromise(stderr) : reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-1000)}`));
    });
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function toRecord(row: typeof mediaFiles.$inferSelect): MediaFileRecord {
  return { id: row.id, kind: row.kind as MediaFileRecord["kind"], refId: row.refId, variant: row.variant as MediaFileRecord["variant"], originUrl: row.originUrl,
    state: row.state as MediaFileRecord["state"], filePath: row.filePath, byteSize: row.byteSize, sha256: row.sha256, errorMessage: row.errorMessage, attempts: row.attempts,
    fetchedAt: row.fetchedAt, updatedAt: row.updatedAt, videoFallback: row.videoFallback, contentType: row.contentType, sourceFileName: row.sourceFileName,
    loudnessState: (row.loudnessState ?? null) as MediaFileRecord["loudnessState"], loudnessSha256: row.loudnessSha256 ?? null, integratedLufs: row.integratedLufs ?? null,
    truePeakDbtp: row.truePeakDbtp ?? null, loudnessRangeLu: row.loudnessRangeLu ?? null, loudnessGainDb: row.loudnessGainDb ?? null,
    loudnessPolicyVersion: row.loudnessPolicyVersion ?? null, loudnessError: row.loudnessError ?? null, loudnessAnalyzedAt: row.loudnessAnalyzedAt ?? null };
}
