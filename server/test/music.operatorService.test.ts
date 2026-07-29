import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "../src/jobs/jobQueue.js";
import { createMusicOperatorHandlers, MusicOperatorConflictError, MusicOperatorService, PgMusicOperatorRepository } from "../src/music/operator/index.js";
import type { Pool } from "pg";
import type { MusicOperatorRepository } from "../src/music/operator/types.js";
import type { MusicRequestRepository, StoredMusicBatch } from "../src/music/requests/types.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

function operatorRepo(target: Partial<{ state: StoredMusicBatch["state"]; amfJobId: string | null; providerStatus: string | null; deliveryCount: number }> = {}): MusicOperatorRepository {
  return { countRequests: vi.fn().mockResolvedValue({ active: 1, attention: 0, failed: 0 }), listRequests: vi.fn().mockResolvedValue([]),
    findBatchTarget: vi.fn().mockResolvedValue({ id: "batch-1", state: target.state ?? "FAILED", amfJobId: target.amfJobId ?? null,
      providerStatus: target.providerStatus ?? null,
      deliveryCount: target.deliveryCount ?? 0 }),
    cleanupEligibility: vi.fn().mockResolvedValue({ exists: true, eligible: true, verifiedFileCount: 2 }) };
}

describe("music operator orchestration", () => {
  it("bounds AMF outages without exposing the caught error", async () => {
    const service = new MusicOperatorService({ repo: operatorRepo(), queue: new JobQueue(new FakeJobRepository()),
      client: { getHealth: vi.fn().mockRejectedValue(new Error("http://private/key=secret")),
        getReadiness: vi.fn().mockRejectedValue(new Error("/config/source-settings.json")) },
      stagingMountConfigured: true, automaticDiscoveryEnabled: false });
    const result = await service.diagnostics();
    expect(result).toMatchObject({ provider: { status: "UNAVAILABLE", health: false, ready: false, components: null },
      animeOngaku: { requests: { active: 1 }, automaticDiscoveryEnabled: false } });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|\/config\//);
  });

  it("bounds diagnostics when the AMF transport never settles", async () => {
    const never = () => new Promise<never>(() => undefined);
    const service = new MusicOperatorService({ repo: operatorRepo(), queue: new JobQueue(new FakeJobRepository()),
      client: { getHealth: never, getReadiness: never }, stagingMountConfigured: true,
      automaticDiscoveryEnabled: false, diagnosticTimeoutMs: 1 });
    await expect(service.diagnostics()).resolves.toMatchObject({ provider: { status: "UNAVAILABLE" } });
  });

  it("deduplicates submission replay by persisted batch and state-gates provider actions", async () => {
    const jobs = new FakeJobRepository(() => new Date(0));
    const service = new MusicOperatorService({ repo: operatorRepo(), queue: new JobQueue(jobs),
      client: { getHealth: vi.fn(), getReadiness: vi.fn() }, stagingMountConfigured: true, automaticDiscoveryEnabled: false });
    await service.enqueueAction("batch-1", "RETRY_PROVIDER");
    await service.enqueueAction("batch-1", "RETRY_PROVIDER");
    expect([...jobs.jobs.values()]).toHaveLength(1);
    expect([...jobs.jobs.values()][0]).toMatchObject({ type: "SUBMIT_AMF_MUSIC_BATCH", payload: { batchId: "batch-1" } });
    await expect(service.enqueueAction("batch-1", "CANCEL_PROVIDER")).rejects.toBeInstanceOf(MusicOperatorConflictError);
  });

  it("gates provider reprocess by persisted provider status and cleanup is dry-run only", async () => {
    const jobs = new FakeJobRepository();
    const provider = new MusicOperatorService({ repo: operatorRepo({ state: "AWAITING_OPERATOR", amfJobId: "amf-1", providerStatus: "completed_with_warnings", deliveryCount: 1 }),
      queue: new JobQueue(jobs), client: { getHealth: vi.fn(), getReadiness: vi.fn() }, stagingMountConfigured: true, automaticDiscoveryEnabled: false });
    await provider.enqueueAction("batch-1", "REPROCESS_PROVIDER");
    expect([...jobs.jobs.values()].map((job) => job.type)).toEqual(["OPERATE_AMF_MUSIC_BATCH"]);
    await expect(provider.cleanupEligibility("batch-1")).resolves.toMatchObject({ mode: "DRY_RUN_ONLY", eligible: true, verifiedFileCount: 2 });
  });

  it.each([
    ["RETRY_PROVIDER", "failed"], ["RETRY_PROVIDER", "download_stalled"],
    ["CANCEL_PROVIDER", "queued"], ["CANCEL_PROVIDER", "searching"], ["CANCEL_PROVIDER", "downloading"],
    ["CANCEL_PROVIDER", "processing"], ["CANCEL_PROVIDER", "awaiting_file_selection"],
    ["REPROCESS_PROVIDER", "completed_with_warnings"],
  ] as const)("allows %s only for compatible persisted status %s", async (action, providerStatus) => {
    const service = new MusicOperatorService({ repo: operatorRepo({ state: "AWAITING_OPERATOR", amfJobId: "amf-1", providerStatus }),
      queue: new JobQueue(new FakeJobRepository()), client: { getHealth: vi.fn(), getReadiness: vi.fn() },
      stagingMountConfigured: true, automaticDiscoveryEnabled: false });
    await expect(service.enqueueAction("batch-1", action)).resolves.toMatchObject({ mode: "PROVIDER" });
  });

  it.each([
    ["RETRY_PROVIDER", "awaiting_selection"], ["CANCEL_PROVIDER", "completed"],
    ["REPROCESS_PROVIDER", "awaiting_file_selection"], ["REPROCESS_PROVIDER", "failed"],
  ] as const)("denies %s for incompatible persisted status %s", async (action, providerStatus) => {
    const service = new MusicOperatorService({ repo: operatorRepo({ state: "AWAITING_OPERATOR", amfJobId: "amf-1", providerStatus }),
      queue: new JobQueue(new FakeJobRepository()), client: { getHealth: vi.fn(), getReadiness: vi.fn() },
      stagingMountConfigured: true, automaticDiscoveryEnabled: false });
    await expect(service.enqueueAction("batch-1", action)).rejects.toBeInstanceOf(MusicOperatorConflictError);
  });

  it("persists a provider action response before enqueueing local import", async () => {
    const batch = { id: "batch-1", requestId: "request-1", index: 0, state: "AWAITING_OPERATOR" as const,
      body: { titles: { romaji: "Show" }, items: [{ kind: "OST" as const }], destination: "anime-ongaku-staging/request-request-1/batch-0" },
      idempotencyKey: "key", amfJobId: "amf-1", warningCount: 0, providerStatus: "completed_with_warnings" as const };
    const repo = { findBatch: vi.fn().mockResolvedValue(batch), recordProviderEvidence: vi.fn(), recordProviderState: vi.fn() } as unknown as MusicRequestRepository;
    const queue = { enqueue: vi.fn().mockResolvedValue({}) } as unknown as JobQueue;
    const result = { id: "amf-1", status: "completed_with_warnings" as const, destination: batch.body.destination, last_progress: 100,
      source_files: [], deliveries: [], item_results: [], warnings: ["review"], error_stage: null, has_error: false,
      created_at: "2026-07-21T12:00:00Z", updated_at: "2026-07-21T12:01:00Z", completed_at: "2026-07-21T12:01:00Z" };
    const handlers = createMusicOperatorHandlers({ repo, queue, client: { retryJob: vi.fn(), cancelJob: vi.fn(), reprocessJob: vi.fn().mockResolvedValue(result) } });
    await handlers.OPERATE_AMF_MUSIC_BATCH({ batchId: "batch-1", action: "REPROCESS_PROVIDER" }, {} as never);
    expect(repo.recordProviderEvidence).toHaveBeenCalledWith("batch-1", result, expect.any(Date));
    expect(vi.mocked(repo.recordProviderEvidence).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(repo.recordProviderState).mock.invocationCallOrder[0]!);
    expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ type: "IMPORT_AMF_MUSIC_BATCH", payload: { batchId: "batch-1" } }));
  });

  it("rejects a queued provider action when persisted provider status changed before execution", async () => {
    const batch = { id: "batch-1", requestId: "request-1", index: 0, state: "AWAITING_OPERATOR" as const,
      body: { titles: { romaji: "Show" }, items: [{ kind: "OST" as const }], destination: "anime-ongaku-staging/request-request-1/batch-0" },
      idempotencyKey: "key", amfJobId: "amf-1", warningCount: 0, providerStatus: "awaiting_selection" as const };
    const repo = { findBatch: vi.fn().mockResolvedValue(batch) } as unknown as MusicRequestRepository;
    const client = { retryJob: vi.fn(), cancelJob: vi.fn(), reprocessJob: vi.fn() };
    const handlers = createMusicOperatorHandlers({ repo, queue: { enqueue: vi.fn() } as unknown as JobQueue, client });
    await expect(handlers.OPERATE_AMF_MUSIC_BATCH({ batchId: "batch-1", action: "REPROCESS_PROVIDER" }, {} as never))
      .rejects.toThrow("stale");
    expect(client.reprocessJob).not.toHaveBeenCalled();
  });
});

describe("music operator safe repository projection", () => {
  it("aggregates mixed batches canonically and includes importing items", async () => {
    const now = new Date("2026-07-21T12:00:00Z");
    const query = vi.fn().mockResolvedValue({ rows: [
      { request_id: "request-1", kitsu_id: "42", created_at: now, updated_at: now, batch_id: "batch-1", batch_index: 0,
        state: "COMPLETED", warning_count: 0, has_provider_job: true, item_pending: "0", item_importing: "0", item_ready: "1", item_attention: "0" },
      { request_id: "request-1", kitsu_id: "42", created_at: now, updated_at: now, batch_id: "batch-2", batch_index: 1,
        state: "PROCESSING", warning_count: 0, has_provider_job: true, item_pending: "0", item_importing: "2", item_ready: "0", item_attention: "0" },
    ] });
    const repo = new PgMusicOperatorRepository({ query } as unknown as Pool);
    const requests = await repo.listRequests();
    expect(requests[0]).toMatchObject({ state: "PROCESSING", batches: [{ itemCounts: { importing: 0 } }, { itemCounts: { importing: 2 } }] });
  });

  it("requires matching READY canonical media metadata for cleanup eligibility", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "batch-1", file_count: "1", verified: false }] });
    const repo = new PgMusicOperatorRepository({ query } as unknown as Pool);
    await expect(repo.cleanupEligibility("batch-1")).resolves.toEqual({ exists: true, eligible: false, verifiedFileCount: 1 });
    expect(query.mock.calls[0]![0]).toContain("FROM media_files");
    expect(query.mock.calls[0]![0]).toContain("m.byte_size=d.verified_byte_size");
    expect(query.mock.calls[0]![0]).toContain("m.sha256=d.verified_sha256");
  });
});
