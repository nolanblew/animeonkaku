import { describe, expect, it } from "vitest";
import { buildMusicRequestBatches } from "../src/music/requests/builder.js";
import { createMusicRequestHandlers, AMF_POLL_INTERVAL_MS } from "../src/music/requests/handlers.js";
import { MusicRequestService, toSummary } from "../src/music/requests/service.js";
import { RetryableJobError } from "../src/jobs/jobWorker.js";
import type { JobQueue } from "../src/jobs/jobQueue.js";
import type { MusicRequestRepository, StoredMusicBatch, StoredMusicRequest } from "../src/music/requests/types.js";
import type { AmfJob } from "../src/music/animeMusicFetcher/schemas.js";
import { vi } from "vitest";
import { AnimeMusicFetcherError } from "../src/music/animeMusicFetcher/errors.js";
import { SUPPORTED_AUDIO_FORMATS } from "../src/music/requests/deliveryImporter.js";

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
    expect((error as RetryableJobError).options).toEqual({ incrementAttempts: false, retryAfterMs: AMF_POLL_INTERVAL_MS });
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
});

function storedBatch(state: StoredMusicBatch["state"]): StoredMusicBatch {
  return { id: "batch-1", requestId: "request-1", index: 0, state,
    body: { titles: { romaji: "Show" }, items: [{ kind: "OST" }], destination: "anime-ongaku-staging/request-request-1/batch-0" },
    idempotencyKey: "anime-ongaku:request-1:0", amfJobId: null, warningCount: 0 };
}
function storedRequest(states: StoredMusicBatch["state"][]): StoredMusicRequest {
  const when = new Date("2026-07-21T12:00:00Z");
  return { id: "request-1", kitsuId: "42", animeThemesAnimeId: 7, createdAt: when, updatedAt: when,
    completedAt: states.every((state) => ["COMPLETED", "COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"].includes(state)) ? when : null,
    batches: states.map((state, index) => ({ ...storedBatch(state), id: `batch-${index}`, index })) };
}
function fakeRepo(batch: StoredMusicBatch): MusicRequestRepository {
  return { loadMetadata: vi.fn(), createOrReplay: vi.fn(), findById: vi.fn(), findLatest: vi.fn(), findBatch: vi.fn().mockResolvedValue(batch),
    listRecoverableBatches: vi.fn(), listRecheckableBatches: vi.fn(), recordProviderState: vi.fn(), recordProviderEvidence: vi.fn() } as unknown as MusicRequestRepository;
}
function amfJob(status: AmfJob["status"]): AmfJob {
  return { id: "amf-1", status, destination: "anime-ongaku-staging/request-request-1/batch-0", last_progress: null,
    source_files: [], deliveries: [], item_results: [], warnings: [], error_stage: null, has_error: false,
    created_at: "2026-07-21T12:00:00Z", updated_at: "2026-07-21T12:00:00Z", completed_at: null };
}
