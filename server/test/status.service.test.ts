import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PgStatusDashboardService } from "../src/status/statusService.js";

describe("PgStatusDashboardService", () => {
  it("aggregates disk, filesystem media, catalog counts, and media kind stats", async () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), "ongaku-status-"));
    mkdirSync(join(mediaRoot, "audio"), { recursive: true });
    mkdirSync(join(mediaRoot, "images", "anime", "42"), { recursive: true });
    mkdirSync(join(mediaRoot, "images", "artists"), { recursive: true });
    writeFileSync(join(mediaRoot, "audio", "1.ogg"), Buffer.alloc(100));
    writeFileSync(join(mediaRoot, "audio", "2.ogg"), Buffer.alloc(150));
    writeFileSync(join(mediaRoot, "images", "anime", "42", "poster.jpg"), Buffer.alloc(25));
    writeFileSync(join(mediaRoot, "images", "artists", "lisa.jpg"), Buffer.alloc(75));

    const queryResults = [
      {
        rows: [
          {
            users: "2",
            anime: "10",
            songs: "42",
            artists: "15",
            playlists: "5",
            mediaFiles: "60",
            readyMediaFiles: "48",
            images: "18",
            audio: "40",
            video: "2",
          },
        ],
      },
      {
        rows: [
          { kind: "AUDIO", total: "40", ready: "36", bytes: "250" },
          { kind: "ANIME_POSTER", total: "18", ready: "12", bytes: "25" },
        ],
      },
    ];

    const service = new PgStatusDashboardService({
      mediaRoot,
      now: () => new Date(1_700_000_000_000),
      statfs: async () => ({ bsize: 10, blocks: 100, bavail: 25 }),
      query: async () => queryResults.shift() ?? { rows: [] },
    });

    const status = await service.getStatus();

    expect(status.disk).toEqual({
      mediaRoot,
      totalBytes: 1000,
      freeBytes: 250,
      usedBytes: 750,
      availablePercent: 25,
    });
    expect(status.mediaStorage).toMatchObject({
      totalBytes: 350,
      fileCount: 4,
      byDirectory: [
        { name: "audio", bytes: 250, fileCount: 2 },
        { name: "images", bytes: 100, fileCount: 2 },
      ],
    });
    expect(status.mediaStorage.byExtension).toEqual([
      { extension: ".jpg", bytes: 100, fileCount: 2 },
      { extension: ".ogg", bytes: 250, fileCount: 2 },
    ]);
    expect(status.catalog).toMatchObject({
      songs: 42,
      images: 18,
      readyMediaFiles: 48,
    });
    expect(status.mediaByKind).toEqual([
      { kind: "AUDIO", total: 40, ready: 36, bytes: 250 },
      { kind: "ANIME_POSTER", total: 18, ready: 12, bytes: 25 },
    ]);
  });
});
