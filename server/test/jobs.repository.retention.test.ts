import { describe, expect, it, vi } from "vitest";
import { PgJobRepository } from "../src/jobs/pgJobRepository.js";

type BoundedJobRepository = {
  list(status: undefined, limit: number): Promise<unknown[]>;
  pruneTerminalJobs(olderThan: Date, limit: number): Promise<number>;
};

describe("PgJobRepository operational bounds", () => {
  it("pushes an explicit SQL limit into the job-list query", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PgJobRepository({ query } as never) as unknown as BoundedJobRepository;

    await repository.list(undefined, 250);

    expect(query).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/LIMIT\s+\$1/i), [250]);
  });

  it("prunes only a bounded batch of old terminal jobs", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 7 }));
    const repository = new PgJobRepository({ query } as never) as unknown as BoundedJobRepository;
    const cutoff = new Date("2026-06-29T00:00:00.000Z");

    await expect(Promise.resolve().then(() => repository.pruneTerminalJobs(cutoff, 500))).resolves.toBe(7);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE[\s\S]*state IN \('DONE', 'CANCELLED'\)[\s\S]*LIMIT\s+\$2/i),
      [cutoff, 500],
    );
  });
});
