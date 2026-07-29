import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { AnimeThemeEntry, AnimeThemesVideoCandidate } from "../src/animethemes/types.js";
import { animethemesAnime, mediaFiles, songs, themes as themeTable, themeVideoSources } from "../src/db/schema.js";
import { DrizzleSyncRepository } from "../src/sync/drizzleSyncRepository.js";

interface InsertOperation {
  table: unknown;
  values: unknown;
  conflict?: unknown;
}

class RecordingDb {
  inserts: InsertOperation[] = [];
  deletes: Array<{ table: unknown; condition: unknown }> = [];

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        const operation: InsertOperation = { table, values };
        this.inserts.push(operation);
        return {
          onConflictDoUpdate: async (conflict: unknown) => {
            operation.conflict = conflict;
          },
        };
      },
    };
  }

  delete(table: unknown) {
    return {
      where: async (condition: unknown) => {
        this.deletes.push({ table, condition });
      },
    };
  }
}

function candidate(input: Partial<AnimeThemesVideoCandidate> & {
  animeThemesVideoId: number;
  animeThemesEntryId: number;
  themeId: number;
}): AnimeThemesVideoCandidate {
  return {
    animeThemesVideoId: input.animeThemesVideoId,
    animeThemesEntryId: input.animeThemesEntryId,
    themeId: input.themeId,
    animeThemesSongId: input.animeThemesSongId ?? 9001,
    entryVersion: input.entryVersion ?? 1,
    entryOrder: input.entryOrder ?? 0,
    link: input.link ?? `https://v.animethemes.moe/${input.animeThemesVideoId}.webm`,
    mimeType: input.mimeType ?? "video/webm",
    resolution: input.resolution ?? 1080,
    source: input.source ?? "BD",
    spoiler: input.spoiler ?? false,
    nsfw: input.nsfw ?? false,
    creditless: input.creditless ?? true,
    subbed: input.subbed ?? false,
    lyrics: input.lyrics ?? false,
    preferenceRank: input.preferenceRank ?? 0,
  };
}

function theme(themeId: number, videoCandidates: AnimeThemesVideoCandidate[]): AnimeThemeEntry {
  return {
    animeId: 2984,
    animeName: "Toradora!",
    animeNameEn: "Tiger X Dragon",
    animeSlug: "toradora",
    animeSynonyms: [],
    kitsuId: "4224",
    coverUrl: null,
    themeId,
    animeThemesSongId: 9001,
    title: "Pre-Parade",
    artistName: "Yui Horie",
    audioUrl: `https://a.animethemes.moe/${themeId}.ogg`,
    videoUrl: videoCandidates[0]?.link ?? null,
    themeType: "OP1",
    artists: [{ name: "Yui Horie", asCharacter: null, alias: null }],
    songResources: [{ site: "MusicBrainz", externalId: "recording-1" }],
    videoCandidates,
    videoFallback: false,
  };
}

describe("DrizzleSyncRepository AnimeThemes catalog persistence", () => {
  it("upserts one global song for a reused AnimeThemes song ID", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);

    await repo.saveAnimeThemesCatalog([
      theme(3040, [candidate({ animeThemesVideoId: 8001, animeThemesEntryId: 7001, themeId: 3040 })]),
      theme(3041, [candidate({ animeThemesVideoId: 8002, animeThemesEntryId: 7002, themeId: 3041 })]),
    ]);

    const songWrites = db.inserts.filter((operation) => operation.table === songs);
    expect(songWrites).toHaveLength(1);
    expect(songWrites[0]!.values).toMatchObject({
      animethemesSongId: 9001,
      musicbrainzRecordingId: "recording-1",
      title: "Pre-Parade",
      normalizedTitle: "pre parade",
      artistCredit: "Yui Horie",
      normalizedArtist: "yui horie",
    });
  });

  it("matches MusicBrainz resources case-insensitively and never erases an existing ID", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);
    const withRecording = {
      ...theme(3040, []),
      songResources: [{ site: "mUsIcBrAiNz", externalId: " mb-recording " }],
    };
    const withoutRecording = { ...theme(3040, []), songResources: [] };

    await repo.saveAnimeThemesCatalog([withRecording]);
    await repo.saveAnimeThemesCatalog([withoutRecording]);

    const songWrites = db.inserts.filter((operation) => operation.table === songs);
    expect(songWrites[0]!.values).toMatchObject({ musicbrainzRecordingId: "mb-recording" });
    expect((songWrites[0]!.conflict as { set: Record<string, unknown> }).set)
      .toMatchObject({ musicbrainzRecordingId: "mb-recording" });
    expect(songWrites[1]!.values).toMatchObject({ musicbrainzRecordingId: null });
    expect((songWrites[1]!.conflict as { set: Record<string, unknown> }).set)
      .not.toHaveProperty("musicbrainzRecordingId");
  });

  it("refreshes remote candidate links without producing downloadable video media", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);
    const original = candidate({
      animeThemesVideoId: 8001,
      animeThemesEntryId: 7001,
      themeId: 3040,
      link: "https://v.animethemes.moe/old.webm",
    });
    const removed = candidate({
      animeThemesVideoId: 8002,
      animeThemesEntryId: 7002,
      themeId: 3040,
      link: "https://v.animethemes.moe/removed.webm",
    });
    const refreshed = { ...original, link: "https://v.animethemes.moe/new.webm" };

    await repo.saveAnimeThemesCatalog([theme(3040, [original, removed])]);
    await repo.saveAnimeThemesCatalog([theme(3040, [refreshed])]);

    const videoWrites = db.inserts.filter((operation) => operation.table === themeVideoSources);
    expect(videoWrites).toHaveLength(3);
    expect(videoWrites[2]!.values).toMatchObject({
      animethemesVideoId: 8001,
      link: "https://v.animethemes.moe/new.webm",
      preferenceRank: 0,
    });
    expect(db.deletes.filter((operation) => operation.table === themeVideoSources)).toHaveLength(2);
    const staleDelete = db.deletes.filter((operation) => operation.table === themeVideoSources)[1]!;
    const staleQuery = new PgDialect().sqlToQuery(staleDelete.condition as SQL);
    expect(staleQuery.sql).toContain("not in");
    expect(staleQuery.params).toEqual([3040, 8001]);
    expect(db.inserts.some((operation) => operation.table === mediaFiles)).toBe(false);
  });

  it("preserves the legacy webm-audio fallback marker independently of selected video", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);
    const selected = candidate({
      animeThemesVideoId: 8001,
      animeThemesEntryId: 7001,
      themeId: 3040,
      link: "https://v.animethemes.moe/selected.webm",
    });
    const input = {
      ...theme(3040, [selected]),
      audioUrl: "https://v.animethemes.moe/audio-fallback.webm",
      videoFallback: true,
    };

    await repo.saveAnimeThemesCatalog([input]);

    const themeWrite = db.inserts.find((operation) => operation.table === themeTable);
    expect(themeWrite!.values).toMatchObject({
      audioOriginUrl: "https://v.animethemes.moe/audio-fallback.webm",
      videoOriginUrl: "https://v.animethemes.moe/audio-fallback.webm",
    });
    expect(db.inserts.find((operation) => operation.table === themeVideoSources)!.values)
      .toMatchObject({ link: "https://v.animethemes.moe/selected.webm" });
  });

  it("persists the AnimeThemes slug so identity can be pinned on outbound provider requests", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);

    await repo.saveAnimeThemesCatalog([theme(3040, [])]);

    const animeWrite = db.inserts.find((operation) => operation.table === animethemesAnime);
    expect(animeWrite!.values).toMatchObject({ id: 2984, slug: "toradora" });
    expect((animeWrite!.conflict as { set: Record<string, unknown> }).set).toMatchObject({ slug: "toradora" });
  });

  it("persists a null slug rather than inventing one when AnimeThemes omits it", async () => {
    const db = new RecordingDb();
    const repo = new DrizzleSyncRepository(db as never);

    await repo.saveAnimeThemesCatalog([{ ...theme(3040, []), animeSlug: null }]);

    const animeWrite = db.inserts.find((operation) => operation.table === animethemesAnime);
    expect(animeWrite!.values).toMatchObject({ slug: null });
  });
});
