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

  it("ignores unnumbered themes and deterministically sorts source rows", () => {
    const [batch] = buildMusicRequestBatches({
      kitsuId: "7",
      requestId: "22222222-2222-4222-8222-222222222222",
      titles: { title: "Show" },
      themes: [
        { id: 9, themeType: "ED2", title: "End", artists: [] },
        { id: 2, themeType: "OP", title: "Ignored", artists: [] },
        { id: 3, themeType: "OP1", title: "Open", artists: ["Singer"] },
      ],
    });
    expect(batch?.body.items.slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "OP", number: 1, version: "FULL" }),
      expect.objectContaining({ kind: "ED", number: 2, version: "FULL" }),
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
