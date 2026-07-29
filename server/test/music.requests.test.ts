import { describe, expect, it } from "vitest";
import { buildMusicRequestBatches } from "../src/music/requests/builder.js";
import { createMusicRequestHandlers, AMF_POLL_INTERVAL_MS } from "../src/music/requests/handlers.js";
import { MusicRequestService, toSummary } from "../src/music/requests/service.js";
import { RetryableJobError } from "../src/jobs/jobWorker.js";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import type { MusicRequestRepository, StoredMusicBatch, StoredMusicRequest, StoredProviderJobLink } from "../src/music/requests/types.js";
import {
  AMF_MAX_PROVIDER_JOBS_PER_BATCH,
  AMF_PROVIDER_JOB_FILE_INDEX_STRIDE,
} from "../src/music/requests/providerGraph.js";
import type { AmfJob } from "../src/music/animeMusicFetcher/schemas.js";
import { vi } from "vitest";
import { AnimeMusicFetcherError } from "../src/music/animeMusicFetcher/errors.js";
import { SUPPORTED_AUDIO_FORMATS } from "../src/music/requests/deliveryImporter.js";
import { parseStoredMusicRequestBody } from "../src/music/requests/repository.js";
import { amfJobCreateSchema } from "../src/music/animeMusicFetcher/schemas.js";

describe("anime music request composition", () => {
  it("composes multilingual numbered full themes plus collection categories in stable batches", () => {
    const batches = buildMusicRequestBatches({
      kitsuId: "42",
      requestId: "11111111-1111-4111-8111-111111111111",
      titles: {
        title: "Alias",
        english: "English",
        japanese: "日本語",
        romaji: "Romaji",
        animeThemesName: "Anime Themes Name",
      },
      themes: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        themeType: index < 5 ? `OP${index + 1}` : `ED${index - 4}`,
        title: `Song ${index + 1}`,
        artists: [`Artist ${index + 1}`],
      })),
    });

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.body.items.length)).toEqual([12, 2]);
    expect(batches[0]?.body).toMatchObject({
      titles: {
        english: "English",
        japanese: "日本語",
        romaji: "Romaji",
        names: ["Alias", "Anime Themes Name"],
      },
      destination: "anime-ongaku-staging/request-11111111-1111-4111-8111-111111111111/batch-0",
      metadata_lookup: true,
      selection_mode: "automatic",
    });
    expect(batches.flatMap((batch) => batch.body.items).map((item) => [item.kind, item.number ?? null]))
      .toEqual([
        ["OP", 1], ["OP", 2], ["OP", 3], ["OP", 4], ["OP", 5],
        ["ED", 1], ["ED", 2], ["ED", 3], ["ED", 4], ["ED", 5],
        ["OST", null], ["CHARACTER_SONG", null], ["DRAMA", null], ["OTHER", null],
      ]);
  });

  it("treats bare OP and ED as number one while preferring explicit duplicates", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "7",
      requestId: "22222222-2222-4222-8222-222222222222",
      titles: { title: "Show" },
      themes: [
        { id: 9, themeType: "ED2", title: "End", artists: [] },
        { id: 2, themeType: "OP", title: "Implicit Open", artists: [] },
        { id: 3, themeType: "OP1", title: "Open", artists: ["Singer"] },
        { id: 4, themeType: "ED", title: "First End", artists: ["Ending Singer"] },
      ],
    });
    expect(batch?.body.items.slice(0, 3)).toEqual([
      expect.objectContaining({ kind: "OP", number: 1, version: "FULL", song_titles: { romaji: "Open" }, artists: ["Singer"] }),
      expect.objectContaining({ kind: "ED", number: 1, version: "FULL", song_titles: { romaji: "First End" }, artists: ["Ending Singer"] }),
      expect.objectContaining({ kind: "ED", number: 2, version: "FULL" }),
    ]);
  });

  it("requests full versions for a unique bare OP and ED", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "49928",
      requestId: "44444444-4444-4444-8444-444444444444",
      titles: { english: "Yano-kun's Ordinary Days", romaji: "Yano-kun no Futsuu no Hibi" },
      themes: [
        { id: 13961, themeType: "OP", title: "POP LIFE", artists: ["FANTASTICS"] },
        { id: 13962, themeType: "ED", title: "Better Off", artists: ["iScream"] },
      ],
    });

    expect(batch?.body.items.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "OP", number: 1, version: "FULL", song_titles: { romaji: "POP LIFE" }, artists: ["FANTASTICS"] }),
      expect.objectContaining({ kind: "ED", number: 1, version: "FULL", song_titles: { romaji: "Better Off" }, artists: ["iScream"] }),
    ]);
  });

  it("requests unique bare themes but does not invent numbering for ambiguous duplicates", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "8",
      requestId: "33333333-3333-4333-8333-333333333333",
      titles: { title: "Show" },
      themes: [
        { id: 1, themeType: "OP", title: "Unknown Open A", artists: [] },
        { id: 2, themeType: "OP", title: "Unknown Open B", artists: [] },
        { id: 3, themeType: "ED", title: "Only Ending", artists: ["Singer"] },
      ],
    });

    expect(batch?.body.items.filter((item) => item.kind === "OP")).toEqual([]);
    expect(batch?.body.items).toContainEqual(expect.objectContaining({
      kind: "ED", number: 1, version: "FULL", song_titles: { romaji: "Only Ending" },
    }));
  });

  it("sends the AnimeThemes slug when known, to pin identity precisely instead of re-derived titles", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "55555555-5555-4555-8555-555555555555",
      animeThemesSlug: "toradora",
      titles: { romaji: "Toradora!" },
      themes: [{ id: 1, themeType: "OP1", title: "Pre-Parade", artists: ["Yui Horie"] }],
    });
    expect(batch?.body.animethemes_slug).toBe("toradora");
  });

  it("omits the AnimeThemes slug entirely when it is not known", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "66666666-6666-4666-8666-666666666666",
      titles: { romaji: "Toradora!" },
      themes: [{ id: 1, themeType: "OP1", title: "Pre-Parade", artists: ["Yui Horie"] }],
    });
    expect(batch?.body).not.toHaveProperty("animethemes_slug");
  });

  it("sends every known song title localization and the matched song's localized artist names", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "77777777-7777-4777-8777-777777777777",
      titles: { romaji: "Toradora!" },
      themes: [{
        id: 1, themeType: "OP1", title: "Pre-Parade", artists: ["Yui Horie"],
        titleEnglish: "Pre-Parade", titleJapanese: "プレパレード", titleRomaji: "Pre-Parade",
        artistNames: [{ romaji: "Yui Horie", japanese: "堀江由衣" }],
      }],
    });
    expect(batch?.body.items[0]).toMatchObject({
      song_titles: { english: "Pre-Parade", japanese: "プレパレード", romaji: "Pre-Parade" },
      artist_names: [{ romaji: "Yui Horie", japanese: "堀江由衣" }],
    });
  });

  it("falls back to the theme title and plain-name artist_names when no localized song is matched yet", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "88888888-8888-4888-8888-888888888888",
      titles: { romaji: "Toradora!" },
      themes: [{ id: 1, themeType: "OP1", title: "Pre-Parade", artists: ["Yui Horie"] }],
    });
    expect(batch?.body.items[0]).toMatchObject({
      song_titles: { romaji: "Pre-Parade" },
      artist_names: [{ romaji: "Yui Horie" }],
    });
  });

  it("keeps song_titles to only the localizations actually known and omits artist_names with no artists", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "99999999-9999-4999-8999-999999999999",
      titles: { romaji: "Toradora!" },
      themes: [{ id: 1, themeType: "OP1", title: "Pre-Parade", artists: [], titleEnglish: "Pre-Parade" }],
    });
    expect(batch?.body.items[0]?.song_titles).toEqual({ english: "Pre-Parade", romaji: "Pre-Parade" });
    expect(batch?.body.items[0]?.artist_names).toBeUndefined();
  });

  it("restricts quality.preferred_formats to formats the delivery importer can actually accept", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "10101010-1010-4101-8101-101010101010",
      titles: { romaji: "Toradora!" },
      themes: [{ id: 1, themeType: "OP1", title: "Pre-Parade", artists: [] }],
    });
    expect(batch?.body.quality?.preferred_formats).toEqual(SUPPORTED_AUDIO_FORMATS);
    expect(batch?.body.quality?.preferred_formats).not.toContain("ape");
    expect(batch?.body.quality?.preferred_formats).not.toContain("wv");
  });

  it("composes the full AMF job body for an anime with a known slug, localized titles, and quality limits", () => {
    const batches = buildMusicRequestBatches({
      kitsuId: "1",
      requestId: "11111111-2222-4333-8444-555555555555",
      animeThemesSlug: "toradora",
      titles: { romaji: "Toradora!", english: "Tiger X Dragon" },
      themes: [{
        id: 3040, themeType: "OP1", title: "Pre-Parade", artists: ["Yui Horie"],
        titleEnglish: "Pre-Parade", titleJapanese: "プレパレード", titleRomaji: "Pre-Parade",
        artistNames: [{ romaji: "Yui Horie", japanese: "堀江由衣" }],
      }],
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.body).toMatchObject({
      titles: { romaji: "Toradora!", english: "Tiger X Dragon" },
      animethemes_slug: "toradora",
      metadata_lookup: true,
      quality: { preferred_formats: SUPPORTED_AUDIO_FORMATS },
      destination: "anime-ongaku-staging/request-11111111-2222-4333-8444-555555555555/batch-0",
      selection_mode: "automatic",
    });
    expect(batches[0]?.body.items).toEqual([
      { kind: "OP", number: 1, version: "FULL", release_preference: "INDIVIDUAL",
        song_titles: { japanese: "プレパレード", romaji: "Pre-Parade", english: "Pre-Parade" },
        artists: ["Yui Horie"], artist_names: [{ japanese: "堀江由衣", romaji: "Yui Horie" }] },
      { kind: "OST", release_preference: "COLLECTION" },
      { kind: "CHARACTER_SONG", release_preference: "COLLECTION" },
      { kind: "DRAMA", release_preference: "COLLECTION" },
      { kind: "OTHER", release_preference: "ANY" },
    ]);
  });
});

describe("anime music request orchestration", () => {
  it("aggregates every batch exactly and never hides a hard failure", () => {
    const request = storedRequest(["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED"]);
    expect(toSummary(request)).toMatchObject({
      state: "FAILED", batchCount: 3, requiresOperatorAction: false,
      counts: { completed: 1, completedWithWarnings: 1, failed: 1 },
    });
    expect(Object.values(toSummary(request).counts).reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it("submits the immutable persisted body/key once and schedules a poll", async () => {
    const batch = storedBatch("QUEUED");
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const client = { submitJob: vi.fn().mockResolvedValue(amfJob("searching")), getJob: vi.fn() };
    const handlers = createMusicRequestHandlers({ repo, queue, client });
    await handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never);
    expect(client.submitJob).toHaveBeenCalledWith(batch.body, batch.idempotencyKey);
    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "SEARCHING", amfJobId: "amf-1", providerStatus: "searching" }), expect.any(Date));
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "POLL_AMF_MUSIC_BATCH", priority: 20 }));
  });

  it("polls once and reschedules through the durable queue without sleeping or attempts", async () => {
    const batch = { ...storedBatch("SEARCHING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("downloading")) };
    const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client });
    const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);
    expect(client.getJob).toHaveBeenCalledTimes(1);
    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "DOWNLOADING", providerStatus: "downloading" }), expect.any(Date));
    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).options).toEqual({
      incrementAttempts: false,
      retryAfterMs: AMF_POLL_INTERVAL_MS,
      recordError: false,
    });
  });

  it("persists completed delivery evidence before moving locally to processing and enqueueing import", async () => {
    const batch = { ...storedBatch("DOWNLOADING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const completed = {
      ...amfJob("completed_with_warnings"),
      warnings: ["one track needs review"],
      item_results: [{ requested_item_index: 0, label: "OST", kind: "OST" as const, number: null,
        status: "delivered" as const, candidate_indexes: [], selected_release_indexes: [0], matched_releases: ["Album"],
        delivered_files: [`${batch.body.destination}/disc/01.flac`], file_count: 1 }],
      deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST" as const, number: null, files: [{
        file_index: 0, relative_path: `${batch.body.destination}/disc/01.flac`, size: 123, sha256: "a".repeat(64),
        metadata: { title: "Track", album: "Album" },
      }] }],
    };
    const handlers = createMusicRequestHandlers({ repo, queue, client: { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(completed) } });

    await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never);

    expect(repo.recordProviderEvidence).toHaveBeenCalledWith(batch.id, completed, expect.any(Date));
    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id,
      expect.objectContaining({ state: "PROCESSING", warningCount: 1 }), expect.any(Date));
    expect(vi.mocked(repo.recordProviderEvidence).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(repo.recordProviderState).mock.invocationCallOrder[0]!);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      type: "IMPORT_AMF_MUSIC_BATCH", payload: { batchId: batch.id },
    }));
  });

  it("persists and imports completed files while the provider job is still processing", async () => {
    const batch = { ...storedBatch("PROCESSING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const partial = {
      ...amfJob("processing"),
      item_results: [{ requested_item_index: 0, label: "OST", kind: "OST" as const, number: null,
        status: "delivered" as const, candidate_indexes: [], selected_release_indexes: [0], matched_releases: ["Album"],
        delivered_files: [`${batch.body.destination}/disc/01.flac`], file_count: 1 }],
      deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST" as const, number: null, files: [{
        file_index: 0, relative_path: `${batch.body.destination}/disc/01.flac`, size: 123, sha256: "a".repeat(64), metadata: {},
      }] }],
    };
    const handlers = createMusicRequestHandlers({ repo, queue,
      client: { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(partial) } });

    const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);

    expect(repo.recordProviderEvidence).toHaveBeenCalledWith(batch.id, partial, expect.any(Date));
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_BATCH" }));
    expect(error).toBeInstanceOf(RetryableJobError);
  });

  it("replays a persisted provider identity without submitting a second request", async () => {
    const batch = { ...storedBatch("SEARCHING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const client = { submitJob: vi.fn(), getJob: vi.fn() };
    const handlers = createMusicRequestHandlers({ repo, queue, client });
    await handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never);
    expect(client.submitJob).not.toHaveBeenCalled();
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "POLL_AMF_MUSIC_BATCH" }));
  });

  it("keeps transient provider retries attempt-neutral so the domain cannot be stranded active", async () => {
    const batch = storedBatch("QUEUED");
    const repo = fakeRepo(batch);
    const client = { submitJob: vi.fn().mockRejectedValue(new AnimeMusicFetcherError("NETWORK_FAILURE", "offline", true)), getJob: vi.fn() };
    const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client });
    const error = await handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);
    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).options).toEqual({ incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
  });

  it("retries an accept-before-job-id crash with the exact persisted idempotency key and body", async () => {
    const batch = storedBatch("QUEUED");
    const repo = fakeRepo(batch);
    const client = { submitJob: vi.fn()
      .mockRejectedValueOnce(new AnimeMusicFetcherError("NETWORK_FAILURE", "connection lost after accept", true))
      .mockResolvedValueOnce(amfJob("searching")), getJob: vi.fn() };
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const handlers = createMusicRequestHandlers({ repo, queue, client });
    await handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch(() => undefined);
    await handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never);
    expect(client.submitJob).toHaveBeenCalledTimes(2);
    expect(client.submitJob.mock.calls[0]).toEqual(client.submitJob.mock.calls[1]);
    expect(client.submitJob).toHaveBeenLastCalledWith(batch.body, batch.idempotencyKey);
  });

  it("does not turn persistence or poll-enqueue failures after provider accept into domain failure", async () => {
    const batch = storedBatch("QUEUED");
    const repo = fakeRepo(batch);
    vi.mocked(repo.recordProviderState).mockRejectedValueOnce(new Error("database unavailable"));
    const queue = { enqueue: vi.fn().mockRejectedValue(new Error("queue unavailable")) } as unknown as JobQueue;
    const client = { submitJob: vi.fn().mockResolvedValue(amfJob("searching")), getJob: vi.fn() };
    const handlers = createMusicRequestHandlers({ repo, queue, client });
    await expect(handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never)).rejects.toThrow("database unavailable");
    expect(repo.recordProviderState).toHaveBeenCalledTimes(1);

    vi.mocked(repo.recordProviderState).mockResolvedValueOnce(undefined);
    await expect(handlers.SUBMIT_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never)).rejects.toThrow("queue unavailable");
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
  });

  it("recovers committed-before-enqueue and accepted-before-job-id persistence windows", async () => {
    const pending = storedBatch("QUEUED");
    const accepted = { ...storedBatch("SEARCHING"), id: "batch-2", amfJobId: "amf-2" };
    const repo = fakeRepo(pending);
    vi.mocked(repo.listRecoverableBatches).mockResolvedValue([pending, accepted]);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    expect(await new MusicRequestService({ repo, queue }).recover()).toBe(2);
    expect(queue.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "SUBMIT_AMF_MUSIC_BATCH", payload: { batchId: pending.id } }));
    expect(queue.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "POLL_AMF_MUSIC_BATCH", payload: { batchId: accepted.id } }));
  });

  it("keeps an archived provider job dormant: non-terminal, never FAILED, still polled forever", async () => {
    const batch = { ...storedBatch("AWAITING_OPERATOR"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("archived")) };
    const handlers = createMusicRequestHandlers({ repo, queue, client });

    const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);

    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id,
      expect.objectContaining({ providerStatus: "archived" }), expect.any(Date));
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "COMPLETED" }), expect.anything());
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "CANCELLED" }), expect.anything());
    expect(error).toBeInstanceOf(RetryableJobError);
  });

  it("imports deliveries reported by an archived job with no operator action", async () => {
    const batch = { ...storedBatch("AWAITING_OPERATOR"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const archivedWithDelivery = {
      ...amfJob("archived"),
      item_results: [{ requested_item_index: 0, label: "OP1", kind: "OP" as const, number: 1,
        status: "delivered" as const, candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [], file_count: 1 }],
      deliveries: [{ requested_item_index: 0, label: "OP1", kind: "OP" as const, number: 1, files: [{
        file_index: 0, relative_path: `${batch.body.destination}/01.flac`, size: 10, sha256: "a".repeat(64), metadata: {},
      }] }],
    };
    const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(archivedWithDelivery) };
    const handlers = createMusicRequestHandlers({ repo, queue, client });

    await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch(() => undefined);

    expect(repo.recordProviderEvidence).toHaveBeenCalledWith(batch.id, archivedWithDelivery, expect.any(Date));
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_BATCH", payload: { batchId: batch.id } }));
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
  });

  it("tolerates an unrecognized provider status instead of failing the domain", async () => {
    const batch = { ...storedBatch("SEARCHING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("brand_new_status")) };
    const handlers = createMusicRequestHandlers({ repo, queue, client });

    const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);

    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id,
      expect.objectContaining({ providerStatus: "brand_new_status" }), expect.any(Date));
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
    expect(error).toBeInstanceOf(RetryableJobError);
  });

  it("treats a poll 404 as provider-gone attention, not a domain failure", async () => {
    const batch = { ...storedBatch("SEARCHING"), amfJobId: "amf-1" };
    const repo = fakeRepo(batch);
    const queue = { enqueue: vi.fn() } as unknown as JobQueue;
    const client = { submitJob: vi.fn(), getJob: vi.fn().mockRejectedValue(
      new AnimeMusicFetcherError("NOT_FOUND", "Anime Music Fetcher could not find job poll", false, 404)) };
    const handlers = createMusicRequestHandlers({ repo, queue, client });

    await expect(handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never)).resolves.toBeUndefined();

    expect(repo.recordProviderState).toHaveBeenCalledWith(batch.id,
      expect.objectContaining({ lastError: expect.stringContaining("could not find job poll") }), expect.any(Date));
    expect(repo.recordProviderState).not.toHaveBeenCalledWith(batch.id, expect.objectContaining({ state: "FAILED" }), expect.anything());
  });

  it("rechecks terminal AMF jobs that may change after human intervention", async () => {
    const awaiting = { ...storedBatch("AWAITING_OPERATOR"), amfJobId: "amf-awaiting" };
    const failed = { ...storedBatch("FAILED"), id: "batch-failed", amfJobId: "amf-failed" };
    const repo = fakeRepo(awaiting);
    vi.mocked(repo.listRecheckableBatches).mockResolvedValue([awaiting, failed]);
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;

    expect(await new MusicRequestService({ repo, queue }).recheckIncomplete()).toBe(2);
    expect(queue.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "POLL_AMF_MUSIC_BATCH", payload: { batchId: awaiting.id } }));
    expect(queue.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: "POLL_AMF_MUSIC_BATCH", payload: { batchId: failed.id } }));
  });

  describe("poll backoff ladder (MC-S16)", () => {
    const EXPECTED_LADDER_MS = [5_000, 30_000, 120_000, 300_000, 600_000, 1_200_000];

    it("walks an unchanged awaiting_selection batch up the ladder to the 20-minute cap and holds it there", async () => {
      const { repo, current } = statefulRepo(storedBatch("AWAITING_OPERATOR"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("awaiting_selection")) };
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      // Give the batch an amfJobId so POLL doesn't take the "not submitted yet" early exit.
      await repo.recordProviderState("batch-1", { state: "AWAITING_OPERATOR", amfJobId: "amf-1" }, clock);

      const observedDelays: number[] = [];
      for (let i = 0; i < EXPECTED_LADDER_MS.length + 1; i++) {
        const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
        expect(error).toBeInstanceOf(RetryableJobError);
        const delay = (error as RetryableJobError).options.retryAfterMs!;
        observedDelays.push(delay);
        clock = new Date(clock.getTime() + delay);
      }

      expect(observedDelays).toEqual([...EXPECTED_LADDER_MS, EXPECTED_LADDER_MS[EXPECTED_LADDER_MS.length - 1]]);
      expect(current().pollBackoffStep).toBe(EXPECTED_LADDER_MS.length - 1);
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "FAILED" }), expect.anything());
      // The manifest never changed, so evidence is written only once (the
      // first observation) — every later poll must skip the write entirely.
      expect(repo.recordProviderEvidence).toHaveBeenCalledTimes(1);
    });

    it("drops back to 5s within one interval the moment the provider document changes", async () => {
      const { repo, current } = statefulRepo(storedBatch("AWAITING_OPERATOR"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("awaiting_selection")) };
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "AWAITING_OPERATOR", amfJobId: "amf-1" }, clock);

      // Walk up to step 3 (5-minute cadence) on an unchanged manifest: poll 1
      // is the first observation (step 0), then three more unchanged polls
      // advance it to step 1, 2, 3.
      for (let i = 0; i < 4; i++) {
        const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
        clock = new Date(clock.getTime() + (error as RetryableJobError).options.retryAfterMs!);
      }
      expect(current().pollBackoffStep).toBe(3);

      // An operator selects a release in AMF's UI: item_results now show a
      // delivered item where before there was nothing.
      client.getJob.mockResolvedValue({
        ...amfJob("awaiting_selection"),
        item_results: [{ requested_item_index: 0, label: "OST", kind: "OST" as const, number: null,
          status: "delivered" as const, candidate_indexes: [], selected_release_indexes: [0], matched_releases: [], delivered_files: [], file_count: 0 }],
      });
      const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect((error as RetryableJobError).options.retryAfterMs).toBe(5_000);
      expect(current().pollBackoffStep).toBe(0);
    });

    it("keeps an archived batch polling at the 20-minute cap forever without ever terminating or failing", async () => {
      const { repo, current } = statefulRepo(storedBatch("AWAITING_OPERATOR"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("archived")) };
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "AWAITING_OPERATOR", amfJobId: "amf-1" }, clock);

      for (let i = 0; i < EXPECTED_LADDER_MS.length + 3; i++) {
        const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
        expect(error).toBeInstanceOf(RetryableJobError);
        clock = new Date(clock.getTime() + (error as RetryableJobError).options.retryAfterMs!);
      }

      expect(current().pollBackoffStep).toBe(EXPECTED_LADDER_MS.length - 1);
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "FAILED" }), expect.anything());
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "COMPLETED" }), expect.anything());
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "CANCELLED" }), expect.anything());
    });

    it("keeps machine-active statuses on the fast 5s cadence regardless of repeated identical polls", async () => {
      const { repo, current } = statefulRepo(storedBatch("DOWNLOADING"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("downloading")) };
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "DOWNLOADING", amfJobId: "amf-1" }, clock);

      for (let i = 0; i < 4; i++) {
        const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
        expect((error as RetryableJobError).options.retryAfterMs).toBe(5_000);
        clock = new Date(clock.getTime() + 5_000);
      }
      expect(current().pollBackoffStep).toBe(0);
    });

    it("makes a poll that fires before poll_not_before a no-op that never touches the provider or persisted state", async () => {
      const farFuture = new Date("2026-07-26T01:00:00Z");
      const batch: StoredMusicBatch = { ...storedBatch("AWAITING_OPERATOR"), amfJobId: "amf-1", pollBackoffStep: 3, pollNotBefore: farFuture };
      const repo = fakeRepo(batch);
      const client = { submitJob: vi.fn(), getJob: vi.fn() };
      // "now" is well before pollNotBefore — e.g. the 15-minute recheckIncomplete
      // sweep pulled the job's own next_run_at forward, but the batch's ladder
      // state says it isn't due yet.
      const earlyNow = new Date("2026-07-26T00:00:01Z");
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => earlyNow });

      const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: batch.id }, {} as never).catch((value) => value);

      expect(client.getJob).not.toHaveBeenCalled();
      expect(repo.recordProviderState).not.toHaveBeenCalled();
      expect(repo.recordProviderEvidence).not.toHaveBeenCalled();
      expect(error).toBeInstanceOf(RetryableJobError);
      expect((error as RetryableJobError).options).toEqual({
        incrementAttempts: false, retryAfterMs: farFuture.getTime() - earlyNow.getTime(),
      });
    });

    it("survives a process restart because the ladder lives on the batch, not in the handler instance", async () => {
      const { repo, current } = statefulRepo(storedBatch("AWAITING_OPERATOR"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = { submitJob: vi.fn(), getJob: vi.fn().mockResolvedValue(amfJob("awaiting_selection")) };
      await repo.recordProviderState("batch-1", { state: "AWAITING_OPERATOR", amfJobId: "amf-1" }, clock);

      const processA = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      const firstError = await processA.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
      clock = new Date(clock.getTime() + (firstError as RetryableJobError).options.retryAfterMs!);
      expect(current().pollBackoffStep).toBe(0); // first observation always resets to step 0

      // Simulate a process restart: a brand new handlers closure, sharing
      // nothing with processA except the (Postgres-backed, in this test
      // in-memory) repository.
      const processB = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client, now: () => clock });
      const secondError = await processB.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect(current().pollBackoffStep).toBe(1);
      expect((secondError as RetryableJobError).options.retryAfterMs).toBe(EXPECTED_LADDER_MS[1]);
    });
  });

  describe("provider job graph (MC-S13 / F1)", () => {
    const DESTINATION = "anime-ongaku-staging/request-request-1/batch-0";

    it("adopts, polls, and attributes every delegated child of a parent to the right batch item", async () => {
      // Shape of live root job ef75e439: delivered items alongside delegated
      // ones, each delegated item naming its own follow-up job.
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": {
          ...amfJob("completed_with_warnings"),
          item_results: [
            itemResult(0, "OP1", "OP", 1, "delivered"),
            itemResult(4, "ED3", "ED", 3, "delegated", "child-a"),
            itemResult(6, "CHARACTER_SONG", "CHARACTER_SONG", null, "delegated", "child-b"),
          ],
          follow_up_jobs: [
            { job_id: "child-a", requested_item_index: 4, label: "ED3" },
            { job_id: "child-b", requested_item_index: 6, label: "CHARACTER_SONG" },
          ],
        },
        "child-a": childJob("child-a", "amf-1", 4, "awaiting_selection", itemResult(0, "ED3", "ED", 3, "possible")),
        "child-b": childJob("child-b", "amf-1", 6, "awaiting_selection", itemResult(0, "CHARACTER_SONG", "CHARACTER_SONG", null, "possible")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(client.getJob.mock.calls.map(([id]) => id)).toEqual(["amf-1", "child-a", "child-b"]);
      expect(graph().map((link) => [link.amfJobId, link.role, link.itemIndex, link.parentAmfJobId])).toEqual([
        ["amf-1", "ROOT", null, null],
        ["child-a", "FOLLOW_UP", 4, "amf-1"],
        ["child-b", "FOLLOW_UP", 6, "amf-1"],
      ]);
      // Each child's item-0 result is remapped onto the batch item its parent delegated.
      const childScopes = vi.mocked(repo.recordProviderEvidence).mock.calls.slice(1);
      expect(childScopes.map(([, job]) => job.item_results[0]?.requested_item_index)).toEqual([4, 6]);
      expect(childScopes.map(([, , , scope]) => scope?.itemIndexes)).toEqual([[4], [6]]);
      // Evidence must be durable before the per-job manifest that suppresses
      // the next write, or a crash in between would lose it permanently.
      expect(Math.max(...vi.mocked(repo.recordProviderEvidence).mock.invocationCallOrder))
        .toBeLessThan(Math.max(...vi.mocked(repo.saveProviderJobs).mock.invocationCallOrder));
    });

    it("walks a child that itself delegates, in the same tick", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(2, "ED1", "ED", 1, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 2, label: "ED1" }] },
        "child-a": { ...childJob("child-a", "amf-1", 2, "completed_with_warnings", itemResult(0, "ED1", "ED", 1, "delegated", "grandchild")),
          follow_up_jobs: [{ job_id: "grandchild", requested_item_index: 0, label: "ED1" }] },
        grandchild: childJob("grandchild", "child-a", 0, "awaiting_selection", itemResult(0, "ED1", "ED", 1, "possible")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(client.getJob.mock.calls.map(([id]) => id)).toEqual(["amf-1", "child-a", "grandchild"]);
      // A grandchild inherits its ancestor's batch item: its own
      // parent_item_index (0) is relative to a single-item job, not the batch.
      expect(graph().find((link) => link.amfJobId === "grandchild")).toMatchObject({ itemIndex: 2, depth: 2 });
    });

    it("terminates when a follow-up points back at an ancestor instead of walking the cycle forever", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 0, label: "OST" }] },
        "child-a": { ...childJob("child-a", "amf-1", 0, "awaiting_selection", itemResult(0, "OST", "OST", null, "possible")),
          // Points back at the root *and* at itself.
          follow_up_jobs: [
            { job_id: "amf-1", requested_item_index: 0, label: "OST" },
            { job_id: "child-a", requested_item_index: 0, label: "OST" },
          ] },
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(client.getJob.mock.calls.map(([id]) => id)).toEqual(["amf-1", "child-a"]);
      expect(graph()).toHaveLength(2);
    });

    it("enforces the per-batch fan-out cap so a runaway provider cannot grow the graph unboundedly", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const followUps = Array.from({ length: AMF_MAX_PROVIDER_JOBS_PER_BATCH * 3 }, (_, index) => ({
        job_id: `child-${index}`, requested_item_index: 0, label: "OST",
      }));
      const jobs: Record<string, AmfJob> = {
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-0")], follow_up_jobs: followUps },
      };
      for (const followUp of followUps) {
        jobs[followUp.job_id] = childJob(followUp.job_id, "amf-1", 0, "awaiting_selection", itemResult(0, "OST", "OST", null, "possible"));
      }
      const client = graphClient(jobs);
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(graph().length).toBe(AMF_MAX_PROVIDER_JOBS_PER_BATCH);
      expect(client.getJob).toHaveBeenCalledTimes(AMF_MAX_PROVIDER_JOBS_PER_BATCH);
    });

    it("attributes a child's delivery into the shared parent destination onto the parent item, in its own file-index window", async () => {
      const { repo } = statefulRepo(storedBatch("PROCESSING"));
      const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(3, "ED2", "ED", 2, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 3, label: "ED2" }] },
        "child-a": { ...childJob("child-a", "amf-1", 3, "completed", itemResult(0, "ED2", "ED", 2, "delivered")),
          deliveries: [{ requested_item_index: 0, label: "ED2", kind: "ED", number: 2, files: [
            { file_index: 0, relative_path: `${DESTINATION}/ed2.flac`, size: 10, sha256: "c".repeat(64), metadata: {} },
          ] }] },
      });
      const handlers = createMusicRequestHandlers({ repo, queue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      const [, childEvidence, , childScope] = vi.mocked(repo.recordProviderEvidence).mock.calls[1]!;
      expect(childEvidence.deliveries[0]).toMatchObject({ requested_item_index: 3 });
      // Containment still holds: the child delivers under the batch destination.
      expect(childEvidence.deliveries[0]?.files[0]?.relative_path.startsWith(DESTINATION)).toBe(true);
      // ...but into the child's own file_index window, so a sibling follow-up
      // job for the same item cannot collide on (item_id, file_index).
      expect(childEvidence.deliveries[0]?.files[0]?.file_index).toBe(AMF_PROVIDER_JOB_FILE_INDEX_STRIDE);
      expect(childScope).toMatchObject({ itemIndexes: [3], fileIndexOffset: AMF_PROVIDER_JOB_FILE_INDEX_STRIDE });
      expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_BATCH", payload: { batchId: "batch-1" } }));
    });

    it("refuses to attribute evidence from a job whose destination escapes the batch staging directory", async () => {
      const { repo } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 0, label: "OST" }] },
        "child-a": { ...childJob("child-a", "amf-1", 0, "completed", itemResult(0, "OST", "OST", null, "delivered")),
          destination: "anime-ongaku-staging/request-someone-else/batch-0",
          deliveries: [{ requested_item_index: 0, label: "OST", kind: "OST", number: null, files: [
            { file_index: 0, relative_path: "anime-ongaku-staging/request-someone-else/batch-0/x.flac", size: 10, sha256: "d".repeat(64), metadata: {} },
          ] }] },
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(vi.mocked(repo.recordProviderEvidence).mock.calls).toHaveLength(1);
      expect(vi.mocked(repo.recordProviderEvidence).mock.calls[0]?.[1].id).toBe("amf-1");
    });

    it("adopts a child that only appears on a later poll — the live backfill case", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const rootWithoutChildren = { ...amfJob("awaiting_selection"), item_results: [itemResult(0, "OST", "OST", null, "possible")] };
      const client = graphClient({ "amf-1": rootWithoutChildren });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "AWAITING_OPERATOR", amfJobId: "amf-1" }, clock);

      const first = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
      expect(graph().map((link) => link.amfJobId)).toEqual(["amf-1"]);

      // AMF delegates the item between polls.
      client.setJob("amf-1", { ...amfJob("completed_with_warnings"),
        item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-late")],
        follow_up_jobs: [{ job_id: "child-late", requested_item_index: 0, label: "OST" }] });
      client.setJob("child-late", childJob("child-late", "amf-1", 0, "awaiting_selection", itemResult(0, "OST", "OST", null, "possible")));
      clock = new Date(clock.getTime() + (first as RetryableJobError).options.retryAfterMs!);

      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(graph().map((link) => link.amfJobId)).toEqual(["amf-1", "child-late"]);
      expect(graph()[1]).toMatchObject({ itemIndex: 0, parentItemIndex: 0, providerStatus: "awaiting_selection" });
    });

    it("is not provider-terminal while any descendant is non-terminal, even with a completed_with_warnings root", async () => {
      // This is exactly the live state of root ef75e439.
      const { repo, current } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(4, "ED3", "ED", 3, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 4, label: "ED3" }] },
        "child-a": childJob("child-a", "amf-1", 4, "awaiting_selection", itemResult(0, "ED3", "ED", 3, "possible")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect(error).toBeInstanceOf(RetryableJobError);
      expect(current().state).toBe("AWAITING_OPERATOR");
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "COMPLETED" }), expect.anything());
    });

    it("settles the batch only once the root and every descendant are terminal", async () => {
      const { repo, current } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 0, label: "OST" }] },
        "child-a": childJob("child-a", "amf-1", 0, "completed", itemResult(0, "OST", "OST", null, "delivered")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      await expect(handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never)).resolves.toBeUndefined();
      expect(current().state).toBe("PROCESSING");
    });

    it("keeps a dormant archived child non-terminal without ever failing the batch", async () => {
      const { repo, current } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(7, "DRAMA", "DRAMA", null, "delegated", "child-archived")],
          follow_up_jobs: [{ job_id: "child-archived", requested_item_index: 7, label: "DRAMA" }] },
        "child-archived": childJob("child-archived", "amf-1", 7, "archived", itemResult(0, "DRAMA", "DRAMA", null, "not_found")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, new Date());

      const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect(error).toBeInstanceOf(RetryableJobError);
      expect(current().state).toBe("AWAITING_OPERATOR");
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "FAILED" }), expect.anything());
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "CANCELLED" }), expect.anything());
    });

    it("retires a follow-up job the provider no longer holds without failing the batch", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-gone")],
          follow_up_jobs: [{ job_id: "child-gone", requested_item_index: 0, label: "OST" }] },
      });
      client.rejectJob("child-gone", new AnimeMusicFetcherError("NOT_FOUND", "Anime Music Fetcher could not find job poll", false, 404));
      let clock = new Date("2026-07-26T00:00:00Z");
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, clock);

      // A gone child is the one genuine stop condition, so the graph settles.
      await expect(handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never)).resolves.toBeUndefined();

      expect(graph().find((link) => link.amfJobId === "child-gone")?.goneAt).toBeInstanceOf(Date);
      expect(repo.recordProviderState).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ state: "FAILED" }), expect.anything());
      // A retired child no longer blocks the graph and is never polled again.
      client.getJob.mockClear();
      clock = new Date(clock.getTime() + 60 * 60 * 1000);
      await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);
      expect(client.getJob.mock.calls.map(([id]) => id)).toEqual(["amf-1"]);
    });

    it("recovers after a restart mid-graph by resuming the persisted graph instead of rediscovering it", async () => {
      const { repo, graph } = statefulRepo(storedBatch("PROCESSING"));
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(4, "ED3", "ED", 3, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 4, label: "ED3" }] },
        "child-a": childJob("child-a", "amf-1", 4, "awaiting_selection", itemResult(0, "ED3", "ED", 3, "possible")),
      });
      let clock = new Date("2026-07-26T00:00:00Z");
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, clock);
      const processA = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      const first = await processA.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
      const discovered = graph();

      // A brand new handler closure sharing nothing but the repository.
      client.getJob.mockClear();
      clock = new Date(clock.getTime() + (first as RetryableJobError).options.retryAfterMs!);
      const processB = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      await processB.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch(() => undefined);

      expect(client.getJob.mock.calls.map(([id]) => id)).toEqual(["amf-1", "child-a"]);
      // Ordinals and file-index windows are stable across the restart, so a
      // child's delivery identity never moves.
      expect(graph().map((link) => [link.amfJobId, link.ordinal, link.fileIndexOffset]))
        .toEqual(discovered.map((link) => [link.amfJobId, link.ordinal, link.fileIndexOffset]));
    });

    it("keeps the whole graph on the fast cadence while any member is still doing machine work", async () => {
      const { repo } = statefulRepo(storedBatch("PROCESSING"));
      const clock = new Date("2026-07-26T00:00:00Z");
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 0, label: "OST" }] },
        "child-a": childJob("child-a", "amf-1", 0, "downloading", itemResult(0, "OST", "OST", null, "found")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, clock);

      const first = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
      const second = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect((first as RetryableJobError).options.retryAfterMs).toBe(AMF_POLL_INTERVAL_MS);
      expect((second as RetryableJobError).options.retryAfterMs).toBe(AMF_POLL_INTERVAL_MS);
    });

    it("resets the ladder when only a descendant's document changes", async () => {
      const { repo, current } = statefulRepo(storedBatch("PROCESSING"));
      let clock = new Date("2026-07-26T00:00:00Z");
      const client = graphClient({
        "amf-1": { ...amfJob("completed_with_warnings"),
          item_results: [itemResult(0, "OST", "OST", null, "delegated", "child-a")],
          follow_up_jobs: [{ job_id: "child-a", requested_item_index: 0, label: "OST" }] },
        "child-a": childJob("child-a", "amf-1", 0, "awaiting_selection", itemResult(0, "OST", "OST", null, "possible")),
      });
      const handlers = createMusicRequestHandlers({ repo, queue: { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue, client, now: () => clock });
      await repo.recordProviderState("batch-1", { state: "PROCESSING", amfJobId: "amf-1" }, clock);

      for (let index = 0; index < 4; index += 1) {
        const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);
        clock = new Date(clock.getTime() + (error as RetryableJobError).options.retryAfterMs!);
      }
      expect(current().pollBackoffStep).toBeGreaterThan(0);

      // Only the child moves — an operator selecting a release in AMF's UI.
      client.setJob("child-a", childJob("child-a", "amf-1", 0, "awaiting_selection", itemResult(0, "OST", "OST", null, "found")));
      const error = await handlers.POLL_AMF_MUSIC_BATCH({ batchId: "batch-1" }, {} as never).catch((value) => value);

      expect((error as RetryableJobError).options.retryAfterMs).toBe(AMF_POLL_INTERVAL_MS);
      expect(current().pollBackoffStep).toBe(0);
    });
  });

  describe("lenient persisted-body reads (F8)", () => {
    it("mapBatch tolerates a stored body the current strict schema would reject instead of throwing", () => {
      const legacyBody = {
        titles: { romaji: "Show" }, items: [{ kind: "OST" }],
        destination: "anime-ongaku-staging/request-x/batch-0",
        // A field that no longer exists on the current strict schema.
        legacy_field: "no longer part of the contract",
      };
      expect(() => amfJobCreateSchema.parse(legacyBody)).toThrow();
      expect(parseStoredMusicRequestBody("batch-x", legacyBody)).toEqual(legacyBody);
    });

    it("still returns the strictly-parsed value for a body that matches the current schema", () => {
      const body = { titles: { romaji: "Show" }, items: [{ kind: "OST" }], destination: "anime-ongaku-staging/request-x/batch-0" };
      expect(parseStoredMusicRequestBody("batch-x", body)).toEqual(amfJobCreateSchema.parse(body));
    });
  });
});

function storedBatch(state: StoredMusicBatch["state"]): StoredMusicBatch {
  return { id: "batch-1", requestId: "request-1", index: 0, state,
    body: { titles: { romaji: "Show" }, items: [{ kind: "OST" }], destination: "anime-ongaku-staging/request-request-1/batch-0" },
    idempotencyKey: "anime-ongaku:request-1:0", amfJobId: null, warningCount: 0,
    pollBackoffStep: 0, pollNotBefore: null, manifestEvidence: { status: null, itemResults: [], deliveries: [] } };
}
function storedRequest(states: StoredMusicBatch["state"][]): StoredMusicRequest {
  const when = new Date("2026-07-21T12:00:00Z");
  return { id: "request-1", kitsuId: "42", animeThemesAnimeId: 7, createdAt: when, updatedAt: when,
    completedAt: states.every((state) => ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(state)) ? when : null,
    batches: states.map((state, index) => ({ ...storedBatch(state), id: `batch-${index}`, index })) };
}
function fakeRepo(batch: StoredMusicBatch, providerJobs: StoredProviderJobLink[] = []): MusicRequestRepository {
  const graph = [...providerJobs];
  return { loadMetadata: vi.fn(), createOrReplay: vi.fn(), findById: vi.fn(), findLatest: vi.fn(), findBatch: vi.fn().mockResolvedValue(batch),
    listRecoverableBatches: vi.fn(), listRecheckableBatches: vi.fn(), recordProviderState: vi.fn(), recordProviderEvidence: vi.fn(),
    listProviderJobs: vi.fn(async () => graph), saveProviderJobs: vi.fn() } as unknown as MusicRequestRepository;
}
function amfJob(status: AmfJob["status"]): AmfJob {
  return { id: "amf-1", status, destination: "anime-ongaku-staging/request-request-1/batch-0", last_progress: null,
    source_files: [], deliveries: [], item_results: [], parent_job_id: null, parent_item_index: null, follow_up_jobs: [],
    warnings: [], error_stage: null, has_error: false,
    created_at: "2026-07-21T12:00:00Z", updated_at: "2026-07-21T12:00:00Z", completed_at: null };
}

type AmfItemResult = AmfJob["item_results"][number];

function itemResult(index: number, label: string, kind: AmfItemResult["kind"], number: number | null,
  status: AmfItemResult["status"], followUpJobId: string | null = null): AmfItemResult {
  return { requested_item_index: index, label, kind, number, status, candidate_indexes: [],
    selected_release_indexes: [], matched_releases: [], delivered_files: [], file_count: 0,
    follow_up_job_id: followUpJobId };
}

/** A single-item follow-up job, shaped like live child 5d8c3275. */
function childJob(id: string, parentJobId: string, parentItemIndex: number, status: string, result: AmfItemResult): AmfJob {
  return { ...amfJob(status), id, parent_job_id: parentJobId, parent_item_index: parentItemIndex, item_results: [result] };
}

/**
 * A provider client double backed by a job graph keyed by provider job id, so
 * a test can assert exactly which jobs a poll tick walked and in what order.
 */
function graphClient(jobs: Record<string, AmfJob>) {
  const store = new Map<string, AmfJob | Error>(Object.entries(jobs));
  const getJob = vi.fn(async (id: string) => {
    const entry = store.get(id);
    if (!entry) throw new AnimeMusicFetcherError("NOT_FOUND", `Anime Music Fetcher could not find job ${id}`, false, 404);
    if (entry instanceof Error) throw entry;
    return entry;
  });
  return {
    submitJob: vi.fn(), getJob,
    setJob: (id: string, job: AmfJob) => store.set(id, job),
    rejectJob: (id: string, error: Error) => store.set(id, error),
  };
}

/**
 * A minimal in-memory MusicRequestRepository double that actually persists
 * what `recordProviderState`/`recordProviderEvidence` are given and reflects
 * it back from `findBatch`, the same way Postgres would across separate poll
 * jobs. Needed to test the poll-backoff ladder, which only makes sense as a
 * sequence of polls each seeing the previous poll's persisted state.
 */
function statefulRepo(initial: StoredMusicBatch) {
  let current: StoredMusicBatch = { ...initial };
  const recordProviderState = vi.fn(async (_batchId: string, input: Record<string, unknown>) => {
    current = {
      ...current,
      state: (input.state as StoredMusicBatch["state"]) ?? current.state,
      amfJobId: (input.amfJobId as string | undefined) ?? current.amfJobId,
      warningCount: (input.warningCount as number | undefined) ?? current.warningCount,
      providerStatus: (input.providerStatus as StoredMusicBatch["providerStatus"]) ?? current.providerStatus,
      pollBackoffStep: (input.pollBackoffStep as number | undefined) ?? current.pollBackoffStep,
      pollNotBefore: "pollNotBefore" in input ? (input.pollNotBefore as Date | null) : current.pollNotBefore,
    };
  });
  const recordProviderEvidence = vi.fn(async (_batchId: string, job: AmfJob) => {
    current = { ...current, manifestEvidence: { status: job.status, itemResults: job.item_results, deliveries: job.deliveries } };
  });
  const findBatch = vi.fn(async () => current);
  const graph = new Map<string, StoredProviderJobLink>();
  const listProviderJobs = vi.fn(async () => [...graph.values()].sort((a, b) => a.ordinal - b.ordinal));
  const saveProviderJobs = vi.fn(async (_batchId: string, links: StoredProviderJobLink[]) => {
    for (const link of links) graph.set(link.amfJobId, { ...link });
  });
  const repo = {
    loadMetadata: vi.fn(), createOrReplay: vi.fn(), findById: vi.fn(), findLatest: vi.fn(), findBatch,
    listRecoverableBatches: vi.fn(), listRecheckableBatches: vi.fn(), recordProviderState, recordProviderEvidence,
    listProviderJobs, saveProviderJobs,
  } as unknown as MusicRequestRepository;
  return { repo, current: () => current, graph: () => [...graph.values()].sort((a, b) => a.ordinal - b.ordinal) };
}
