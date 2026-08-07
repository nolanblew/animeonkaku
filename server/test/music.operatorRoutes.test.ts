import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { AuthService } from "../src/auth/service.js";
import { StubKitsuAuthClient } from "../src/auth/stubKitsuAuthClient.js";
import type { MusicOperatorApiService } from "../src/music/operator/index.js";
import { FakeAuthRepo } from "./helpers/fakeAuthRepo.js";

describe("AMF operator API", () => {
  let app: FastifyInstance;
  const service: MusicOperatorApiService = {
    diagnostics: vi.fn().mockResolvedValue({
      provider: { status: "UNAVAILABLE", health: false, ready: false, components: null },
      animeOngaku: { requests: { active: 2, attention: 1, failed: 1 }, automaticDiscoveryEnabled: false, stagingMountConfigured: true },
    }),
    listRequests: vi.fn().mockResolvedValue([{ id: "request-1", kitsuId: "42", state: "AWAITING_OPERATOR", createdAt: "2026-07-21T12:00:00.000Z",
      updatedAt: "2026-07-21T12:01:00.000Z", batches: [{ id: "batch-1", index: 0, state: "AWAITING_OPERATOR", warningCount: 1,
        hasProviderJob: true, itemCounts: { pending: 0, ready: 1, attention: 1 } }] }]),
    enqueueAction: vi.fn().mockResolvedValue({ batchId: "batch-1", action: "REPROCESS_PROVIDER", mode: "PROVIDER", state: "QUEUED" }),
    cleanupEligibility: vi.fn().mockResolvedValue({ batchId: "batch-1", mode: "DRY_RUN_ONLY", eligible: true, verifiedFileCount: 2,
      reason: "Canonical copies are verified; staging cleanup remains an explicit external operator action." }),
  };

  beforeEach(() => {
    app = buildApp({ authService: new AuthService(new FakeAuthRepo(), new StubKitsuAuthClient()),
      health: { pingDb: async () => {}, mediaRoot: process.cwd() }, musicOperator: service });
  });
  afterEach(async () => { vi.clearAllMocks(); await app.close(); });

  async function bearer() {
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "operator", password: "secret" } });
    return response.json().token as string;
  }

  it("requires authentication for diagnostics, requests, actions, and cleanup dry-run", async () => {
    for (const request of [
      { method: "GET", url: "/v1/admin/music/diagnostics" },
      { method: "GET", url: "/v1/admin/music/requests" },
      { method: "POST", url: "/v1/admin/music/batches/batch-1/reprocess" },
      { method: "GET", url: "/v1/admin/music/batches/batch-1/staging-cleanup" },
    ]) expect((await app.inject(request as never)).statusCode).toBe(401);
  });

  it("returns bounded outage diagnostics and safe request state without internal provider data", async () => {
    const token = await bearer();
    const headers = { authorization: `Bearer ${token}` };
    const diagnostics = await app.inject({ method: "GET", url: "/v1/admin/music/diagnostics", headers });
    const requests = await app.inject({ method: "GET", url: "/v1/admin/music/requests", headers });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json().provider).toEqual({ status: "UNAVAILABLE", health: false, ready: false, components: null });
    expect(requests.json().requests[0].batches[0]).toMatchObject({ id: "batch-1", hasProviderJob: true, state: "AWAITING_OPERATOR" });
    const serialized = `${diagnostics.body}${requests.body}`;
    for (const forbidden of ["absolute_path", "relative_path", "download_url", "media_url", "api_key", "magnet:", "/library/", "lastError", "amfJobId"])
      expect(serialized).not.toContain(forbidden);
  });

  it("queues a batch-bound durable action and exposes cleanup eligibility as dry-run only", async () => {
    const token = await bearer();
    const headers = { authorization: `Bearer ${token}` };
    const action = await app.inject({ method: "POST", url: "/v1/admin/music/batches/batch-1/reprocess", headers });
    expect(action.statusCode).toBe(202);
    expect(service.enqueueAction).toHaveBeenCalledWith("batch-1", "REPROCESS_PROVIDER");
    const cleanup = await app.inject({ method: "GET", url: "/v1/admin/music/batches/batch-1/staging-cleanup", headers });
    expect(cleanup.statusCode).toBe(200);
    expect(cleanup.json().cleanup).toMatchObject({ mode: "DRY_RUN_ONLY", eligible: true });
  });
});
