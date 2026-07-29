import { describe, expect, it, vi } from "vitest";
import { startLocalizedCatalogBackfill } from "../src/music/requests/localizedCatalogBackfill.js";

describe("localized catalog repair startup behavior", () => {
  it("schedules optional AMF repair after readiness instead of awaiting it during startup", async () => {
    const task = { batchId: "batch-1", amfJobId: "amf-1" };
    const repo = {
      listLocalizedCatalogBackfillTargets: vi.fn(async () => [task]),
      recordProviderEvidence: vi.fn(async () => {}),
      backfillLocalizedCatalog: vi.fn(async () => 1),
    };
    const client = { getJob: vi.fn(async () => ({ id: "amf-1" })) };
    const logger = { info: vi.fn(), warn: vi.fn() };
    let scheduled: (() => Promise<void>) | undefined;

    startLocalizedCatalogBackfill({
      repo,
      client,
      logger,
      schedule: (run) => { scheduled = run; },
    });

    expect(scheduled).toBeTypeOf("function");
    expect(repo.listLocalizedCatalogBackfillTargets).not.toHaveBeenCalled();
    expect(client.getJob).not.toHaveBeenCalled();

    await scheduled!();

    expect(repo.recordProviderEvidence).toHaveBeenCalledWith("batch-1", { id: "amf-1" }, expect.any(Date));
    expect(repo.backfillLocalizedCatalog).toHaveBeenCalledOnce();
  });
});
