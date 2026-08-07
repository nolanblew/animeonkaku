import { describe, expect, it, vi } from "vitest";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import { buildMusicRequestBatches } from "../src/music/requests/builder.js";
import { MusicRequestService, toSummary } from "../src/music/requests/service.js";
import type { MusicRequestRepository, StoredMusicRequest } from "../src/music/requests/types.js";

const metadata = {
  kitsuId: "42",
  requestId: "",
  animeThemesAnimeId: 7,
  animeThemesSlug: "show",
  titles: { romaji: "Show" },
  themes: [
    { id: 11, themeType: "OP1", title: "Opening", artists: ["Singer"] },
    { id: 12, themeType: "ED1", title: "Ending", artists: ["Singer"] },
  ],
};

describe("scoped anime music requests", () => {
  it("builds FULL_SONGS as OP/ED FULL individual items only", () => {
    const batches = buildMusicRequestBatches(
      { ...metadata, requestId: "11111111-1111-4111-8111-111111111111" },
      { scope: "FULL_SONGS" } as never,
    );

    expect(batches.flatMap((batch) => batch.body.items)).toEqual([
      expect.objectContaining({ kind: "OP", number: 1, version: "FULL", release_preference: "INDIVIDUAL" }),
      expect.objectContaining({ kind: "ED", number: 1, version: "FULL", release_preference: "INDIVIDUAL" }),
    ]);
    expect(batches.every((batch) => batch.body.items.length <= 12)).toBe(true);
  });

  it("builds EXTRA_MUSIC as the four explicit related categories only", () => {
    const batches = buildMusicRequestBatches(
      { ...metadata, requestId: "22222222-2222-4222-8222-222222222222" },
      { scope: "EXTRA_MUSIC" } as never,
    );

    expect(batches.flatMap((batch) => batch.body.items).map((item) => item.kind))
      .toEqual(["OST", "CHARACTER_SONG", "DRAMA", "OTHER"]);
    expect(batches.flatMap((batch) => batch.body.items).some((item) => item.kind === "OP" || item.kind === "ED"))
      .toBe(false);
  });

  it.each(["DEBUG_USER", "AUTOMATIC"] as const)(
    "maps %s creation to FULL_SONGS and persists no related categories",
    async (source) => {
      const { service, repo } = fixture(metadata);

      await service.trigger("user-1", "42", source);

      expect(repo.createOrReplay).toHaveBeenCalledWith(expect.objectContaining({
        source,
        scope: "FULL_SONGS",
        batches: [expect.objectContaining({
          body: expect.objectContaining({ items: [
            expect.objectContaining({ kind: "OP" }),
            expect.objectContaining({ kind: "ED" }),
          ] }),
        })],
      }));
    },
  );

  it("creates explicit EXTRA_MUSIC independently", async () => {
    const { service, repo } = fixture(metadata);

    await service.trigger("user-1", "42", "DEBUG_USER", "EXTRA_MUSIC" as never);

    expect(repo.createOrReplay).toHaveBeenCalledWith(expect.objectContaining({
      scope: "EXTRA_MUSIC",
      batches: [expect.objectContaining({
        body: expect.objectContaining({ items: [
          expect.objectContaining({ kind: "OST" }),
          expect.objectContaining({ kind: "CHARACTER_SONG" }),
          expect.objectContaining({ kind: "DRAMA" }),
          expect.objectContaining({ kind: "OTHER" }),
        ] }),
      })],
    }));
  });

  it("rejects an empty FULL_SONGS request before persistence", async () => {
    const { service, repo, queue } = fixture({ ...metadata, themes: [] });

    await expect(service.trigger("user-1", "42", "DEBUG_USER")).rejects.toThrow(/no.+opening|ending|empty/i);

    expect(repo.createOrReplay).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("projects scope on summaries and independent deterministic status rows", async () => {
    const full = storedRequest("full", "FULL_SONGS", null);
    const extra = storedRequest("extra", "EXTRA_MUSIC", new Date("2026-08-07T12:00:00Z"));
    const { service, repo } = fixture(metadata);
    repo.findLatest.mockImplementation(async (_animeId: number, scope: string) => scope === "FULL_SONGS" ? full : extra);
    repo.getScopeAvailability.mockResolvedValue({
      FULL_SONGS: { eligibleCount: 2, availableCount: 1 },
      EXTRA_MUSIC: { eligibleCount: 4, availableCount: 2 },
    });

    expect(toSummary(full as never)).toMatchObject({ scope: "FULL_SONGS", active: true });
    await expect(service.status("42")).resolves.toEqual({
      kitsuId: "42",
      scopes: [
        expect.objectContaining({ scope: "FULL_SONGS", active: true, eligibleCount: 2, availableCount: 1, missingCount: 1 }),
        expect.objectContaining({ scope: "EXTRA_MUSIC", active: false, eligibleCount: 4, availableCount: 2, missingCount: 2 }),
      ],
    });
  });
});

function fixture(loadedMetadata: typeof metadata) {
  const created = storedRequest("created", "FULL_SONGS", null);
  const repo = {
    loadMetadata: vi.fn().mockResolvedValue(loadedMetadata),
    createOrReplay: vi.fn().mockResolvedValue({ request: created, created: true }),
    findById: vi.fn(),
    findLatest: vi.fn(),
    getScopeAvailability: vi.fn(),
    findBatch: vi.fn(),
    listRecoverableBatches: vi.fn(),
    listRecheckableBatches: vi.fn(),
    recordProviderState: vi.fn(),
    recordProviderEvidence: vi.fn(),
    listProviderJobs: vi.fn(),
    saveProviderJobs: vi.fn(),
  } as unknown as MusicRequestRepository & Record<string, ReturnType<typeof vi.fn>>;
  const queue = { enqueue: vi.fn().mockResolvedValue({}) };
  let next = 0;
  const service = new MusicRequestService({ repo, queue: queue as unknown as JobQueue, uuid: () => `generated-${++next}` });
  return { service, repo, queue };
}

function storedRequest(id: string, scope: string, completedAt: Date | null): StoredMusicRequest {
  const when = new Date("2026-08-07T12:00:00Z");
  return {
    id, kitsuId: "42", animeThemesAnimeId: 7, scope,
    createdAt: when, updatedAt: when, completedAt,
    batches: [{
      id: `${id}-batch`, requestId: id, index: 0, state: completedAt ? "COMPLETED" : "QUEUED",
      body: { titles: { romaji: "Show" }, items: [{ kind: scope === "EXTRA_MUSIC" ? "OST" : "OP", ...(scope === "EXTRA_MUSIC" ? {} : { number: 1 }) }], destination: `request-${id}` },
      idempotencyKey: `key-${id}`, amfJobId: null, warningCount: 0,
      pollBackoffStep: 0, pollNotBefore: null, manifestEvidence: { status: null, itemResults: [], deliveries: [] },
    }],
  } as StoredMusicRequest;
}
