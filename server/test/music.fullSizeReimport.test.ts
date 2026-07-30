import { describe, expect, it, vi } from "vitest";
import { RetryableJobError } from "../src/jobs/jobWorker.js";
import { createFullSizeReimportHandlers } from "../src/music/requests/fullSizeReimport.js";

describe("full-size re-import orchestration", () => {
  it("starts one deterministic fresh snapshot and waits without consuming attempts", async () => {
    const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state: "PROCESSING" }) };
    const cleanup = { finalize: vi.fn() };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    const error = await handler(
      { kitsuId: "1", userId: "7" },
      { id: 41 } as never,
      {} as never,
    ).catch((value) => value);

    expect(requests.startFullSizeReimport).toHaveBeenCalledWith("7", "1", "admin-reimport-41");
    expect(error).toBeInstanceOf(RetryableJobError);
    expect((error as RetryableJobError).options).toMatchObject({ incrementAttempts: false, recordError: false });
    expect(cleanup.finalize).not.toHaveBeenCalled();
  });

  it("prunes superseded AMF-owned artifacts only after the fresh snapshot completes", async () => {
    const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state: "COMPLETED" }) };
    const cleanup = { finalize: vi.fn().mockResolvedValue({ prunedSongs: 2, prunedFiles: 2 }) };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    await handler({ kitsuId: "1", userId: "7" }, { id: 41 } as never, {} as never);

    expect(cleanup.finalize).toHaveBeenCalledWith("admin-reimport-41", "1");
  });

  it.each(["COMPLETED_WITH_WARNINGS", "FAILED", "CANCELLED"])(
    "retains the old catalog when the fresh snapshot ends as %s",
    async (state) => {
      const requests = { startFullSizeReimport: vi.fn().mockResolvedValue({ state }) };
      const cleanup = { finalize: vi.fn() };
      const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

      await handler({ kitsuId: "1", userId: "7" }, { id: 41 } as never, {} as never);

      expect(cleanup.finalize).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed durable payloads before changing catalog state", async () => {
    const requests = { startFullSizeReimport: vi.fn() };
    const cleanup = { finalize: vi.fn() };
    const handler = createFullSizeReimportHandlers({ requests, cleanup }).REIMPORT_AMF_FULL_SIZE;

    await expect(handler({ kitsuId: "1" }, { id: 41 } as never, {} as never)).rejects.toThrow("userId");
    expect(requests.startFullSizeReimport).not.toHaveBeenCalled();
  });
});
