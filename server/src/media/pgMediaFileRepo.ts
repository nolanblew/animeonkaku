import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { mediaFiles } from "../db/schema.js";
import type { MediaFileRepo, SaveMediaFileInput } from "./types.js";

export class DrizzleMediaFileRepo implements MediaFileRepo {
  constructor(private readonly db: Db) {}

  async markDownloading(input: SaveMediaFileInput): Promise<void> {
    await this.upsert(input, {
      state: "DOWNLOADING",
      filePath: null,
      byteSize: null,
      sha256: null,
      errorMessage: null,
      updatedAt: new Date(),
      videoFallback: input.videoFallback,
    });
  }

  async markReady(input: SaveMediaFileInput & { byteSize: number; sha256: string }): Promise<void> {
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
    });
  }

  private async upsert(
    input: SaveMediaFileInput,
    update: Partial<typeof mediaFiles.$inferInsert> & { incrementAttempts?: boolean },
  ) {
    const existing = await this.db
      .select({ id: mediaFiles.id, attempts: mediaFiles.attempts })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.kind, input.kind), eq(mediaFiles.refId, input.refId)))
      .limit(1);
    const { incrementAttempts, ...columns } = update;
    if (existing.length === 0) {
      await this.db.insert(mediaFiles).values({
        kind: input.kind,
        refId: input.refId,
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
        .where(and(eq(mediaFiles.kind, input.kind), eq(mediaFiles.refId, input.refId)));
    }
  }
}
