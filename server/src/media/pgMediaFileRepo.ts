import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { mediaFiles } from "../db/schema.js";
import type {
  MediaDescriptor,
  MediaFileRecord,
  MediaFileRepo,
  MediaKind,
  MediaState,
  MediaVariant,
  SaveMediaFileInput,
} from "./types.js";

export class DrizzleMediaFileRepo implements MediaFileRepo {
  constructor(private readonly db: Db) {}

  async find(descriptor: MediaDescriptor): Promise<MediaFileRecord | null> {
    const rows = await this.db
      .select()
      .from(mediaFiles)
      .where(
        and(
          eq(mediaFiles.kind, descriptor.kind),
          eq(mediaFiles.refId, descriptor.refId),
          eq(mediaFiles.variant, descriptor.variant),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind as MediaKind,
      refId: row.refId,
      variant: row.variant as MediaVariant,
      originUrl: row.originUrl,
      state: row.state as MediaState,
      filePath: row.filePath,
      byteSize: row.byteSize,
      sha256: row.sha256,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      fetchedAt: row.fetchedAt,
      updatedAt: row.updatedAt,
      videoFallback: row.videoFallback,
      contentType: row.contentType,
      sourceFileName: row.sourceFileName,
      loudnessState: (row.loudnessState ?? null) as MediaFileRecord["loudnessState"],
      loudnessSha256: row.loudnessSha256 ?? null,
      integratedLufs: row.integratedLufs ?? null,
      truePeakDbtp: row.truePeakDbtp ?? null,
      loudnessRangeLu: row.loudnessRangeLu ?? null,
      loudnessGainDb: row.loudnessGainDb ?? null,
      loudnessPolicyVersion: row.loudnessPolicyVersion ?? null,
      loudnessError: row.loudnessError ?? null,
      loudnessAnalyzedAt: row.loudnessAnalyzedAt ?? null,
    };
  }

  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    await this.upsert(input, {
      state: "DOWNLOADING",
      filePath: null,
      byteSize: null,
      errorMessage: null,
      updatedAt: new Date(),
      videoFallback: input.videoFallback,
      contentType: input.contentType ?? null,
      sourceFileName: input.sourceFileName ?? null,
    });
  }

  async markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void> {
    const existing = await this.find({ kind: input.kind, refId: input.refId, variant: input.variant });
    // Re-importing identical source bytes keeps the analysis associated with
    // that SHA. A changed artifact starts PENDING and can never inherit gain.
    const invalidateLoudness = input.kind === "AUDIO" && existing?.sha256 !== input.sha256;
    await this.upsert(input, {
      state: "READY",
      filePath: input.filePath,
      byteSize: input.byteSize,
      sha256: input.sha256,
      errorMessage: null,
      fetchedAt: new Date(),
      updatedAt: new Date(),
      incrementAttempts: true,
      videoFallback: input.videoFallback,
      contentType: input.contentType ?? null,
      sourceFileName: input.sourceFileName ?? null,
      ...(invalidateLoudness ? {
        loudnessState: "PENDING", loudnessSha256: null, integratedLufs: null,
        truePeakDbtp: null, loudnessRangeLu: null, loudnessGainDb: null,
        loudnessPolicyVersion: null, loudnessError: null, loudnessAnalyzedAt: null,
      } : input.kind !== "AUDIO" ? {
        loudnessState: null, loudnessSha256: null, integratedLufs: null,
        truePeakDbtp: null, loudnessRangeLu: null, loudnessGainDb: null,
        loudnessPolicyVersion: null, loudnessError: null, loudnessAnalyzedAt: null,
      } : {}),
    });
  }

  async markFailed(input: SaveMediaFileInput & { errorMessage: string }): Promise<void> {
    await this.upsert(input, {
      state: "FAILED",
      filePath: null,
      byteSize: null,
      sha256: null,
      errorMessage: input.errorMessage,
      updatedAt: new Date(),
      incrementAttempts: true,
      videoFallback: input.videoFallback,
      loudnessState: null,
      loudnessSha256: null,
      integratedLufs: null,
      truePeakDbtp: null,
      loudnessRangeLu: null,
      loudnessGainDb: null,
      loudnessPolicyVersion: null,
      loudnessError: null,
      loudnessAnalyzedAt: null,
    });
  }

  private async upsert(
    input: SaveMediaFileInput,
    update: Partial<typeof mediaFiles.$inferInsert> & { incrementAttempts?: boolean },
  ) {
    const match = and(
      eq(mediaFiles.kind, input.kind),
      eq(mediaFiles.refId, input.refId),
      eq(mediaFiles.variant, input.variant),
    );
    const existing = await this.db
      .select({ id: mediaFiles.id, attempts: mediaFiles.attempts })
      .from(mediaFiles)
      .where(match)
      .limit(1);
    const { incrementAttempts, ...columns } = update;
    if (existing.length === 0) {
      await this.db.insert(mediaFiles).values({
        kind: input.kind,
        refId: input.refId,
        variant: input.variant,
        originUrl: input.originUrl,
        attempts: incrementAttempts ? 1 : 0,
        ...columns,
      });
    } else {
      await this.db
        .update(mediaFiles)
        .set({
          originUrl: input.originUrl,
          attempts: existing[0]!.attempts + (incrementAttempts ? 1 : 0),
          ...columns,
        })
        .where(match);
    }
  }
}
