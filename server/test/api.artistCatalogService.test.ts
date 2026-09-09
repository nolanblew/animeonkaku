import { describe, expect, it, vi } from "vitest";
import { artistCatalogs, artists } from "../src/db/schema.js";
import { ArtistCatalogService } from "../src/api/artistCatalogService.js";
import { JobQueue } from "../src/jobs/index.js";
import { FakeJobRepository } from "./helpers/fakeJobRepository.js";

type StoredCatalog = {
  slug: string;
  artist: Record<string, unknown>;
  themes: unknown[];
  fullSongs: unknown[];
  status: "loading" | "refreshing" | "ready" | "error";
  hasData: boolean;
  lastUpdatedAt: Date | null;
  refreshRequestedAt: Date | null;
  lastError: string | null;
};

class FakeQuery {
  private table: unknown;
  private result: Record<string, unknown>[] = [];

  constructor(private readonly db: FakeCatalogDb) {}

  from(table: unknown): this {
    this.table = table;
    this.result = this.db.rowsFor(table);
    return this;
  }

  leftJoin(): this { return this; }
  innerJoin(): this { return this; }
  orderBy(): this { return this; }
  groupBy(): this { return this; }
  where(): this {
    this.result = this.db.rowsFor(this.table);
    return this;
  }

  limit(value: number): Promise<Record<string, unknown>[]> {
    return Promise.resolve(this.result.slice(0, value));
  }

  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    resolve?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(resolve, reject);
  }
}

class FakeInsert {
  private input: Record<string, unknown> = {};

  constructor(private readonly db: FakeCatalogDb, private readonly table: unknown) {}

  values(value: Record<string, unknown>): this {
    this.input = value;
    return this;
  }

  onConflictDoNothing(): Promise<void> {
    this.db.applyInsert(this.table, this.input, false);
    return Promise.resolve();
  }

  onConflictDoUpdate(options: { set: Record<string, unknown> }): Promise<void> {
    this.db.applyInsert(this.table, { ...this.input, ...options.set }, true);
    return Promise.resolve();
  }
}

class FakeUpdate {
  private values: Record<string, unknown> = {};

  constructor(private readonly db: FakeCatalogDb, private readonly table: unknown) {}

  set(values: Record<string, unknown>): this {
    this.values = values;
    return this;
  }

  where(): Promise<void> {
    this.db.applyUpdate(this.table, this.values);
    return Promise.resolve();
  }
}

class FakeCatalogDb {
  readonly catalogRows = new Map<string, StoredCatalog>();
  readonly artistRows = new Map<string, { slug: string; name: string; imageUrl: string | null }>();

  select(): FakeQuery { return new FakeQuery(this); }
  insert(table: unknown): FakeInsert { return new FakeInsert(this, table); }
  update(table: unknown): FakeUpdate { return new FakeUpdate(this, table); }

  rowsFor(table: unknown): Record<string, unknown>[] {
    if (table === artistCatalogs) return [...this.catalogRows.values()] as unknown as Record<string, unknown>[];
    if (table === artists) return [...this.artistRows.values()] as unknown as Record<string, unknown>[];
    return [];
  }

  applyInsert(table: unknown, input: Record<string, unknown>, updateExisting: boolean): void {
    if (table === artists) {
      const slug = String(input.slug);
      if (!this.artistRows.has(slug)) {
        this.artistRows.set(slug, {
          slug,
          name: String(input.name),
          imageUrl: (input.imageUrl as string | null | undefined) ?? null,
        });
      }
      return;
    }
    if (table !== artistCatalogs) return;
    const slug = String(input.slug);
    const current = this.catalogRows.get(slug);
    if (current && !updateExisting) return;
    this.catalogRows.set(slug, {
      slug,
      artist: (input.artist as Record<string, unknown>) ?? current?.artist ?? {},
      themes: (input.themes as unknown[]) ?? current?.themes ?? [],
      fullSongs: (input.fullSongs as unknown[]) ?? current?.fullSongs ?? [],
      status: (input.status as StoredCatalog["status"]) ?? current?.status ?? "loading",
      hasData: Boolean(input.hasData ?? current?.hasData ?? false),
      lastUpdatedAt: (input.lastUpdatedAt as Date | null | undefined) ?? current?.lastUpdatedAt ?? null,
      refreshRequestedAt: (input.refreshRequestedAt as Date | null | undefined) ?? current?.refreshRequestedAt ?? null,
      lastError: (input.lastError as string | null | undefined) ?? current?.lastError ?? null,
    });
  }

  applyUpdate(table: unknown, values: Record<string, unknown>): void {
    if (table !== artistCatalogs) return;
    for (const row of this.catalogRows.values()) Object.assign(row, values);
  }
}

function fixture(name = "Angela") {
  return {
    artist: { id: 7, name, slug: name.toLowerCase(), artworkUrl: "https://cdn.invalid/artist.jpg" },
    themes: [{ id: 1, title: "OP1", anime: [{ kitsuId: "1", title: "Anime One" }] }],
    fullSongs: [],
  };
}

describe("ArtistCatalogService durable lifecycle", () => {
  it("returns a loading placeholder without upstream work, then persists ready data and dedupes GETs", async () => {
    const db = new FakeCatalogDb();
    const repo = new FakeJobRepository();
    const upstream = { artist: vi.fn().mockResolvedValue(fixture()) };
    const service = new ArtistCatalogService(db as never, new JobQueue(repo), upstream, {
      now: () => new Date("2026-09-08T00:00:00Z"),
      ttlMs: 60_000,
      refreshCooldownMs: 10_000,
    });

    await expect(service.catalog("unknown-artist")).resolves.toMatchObject({
      artist: { name: "Unknown Artist" },
      themes: [],
      catalogState: { status: "loading", hasData: false },
    });
    await service.catalog("unknown-artist");
    expect(upstream.artist).not.toHaveBeenCalled();
    expect(await repo.list()).toHaveLength(1);

    const job = await repo.claimNext(new Date("2099-01-01T00:00:00Z"));
    await service.runRefresh(job!.payload, job!);
    await repo.complete(job!.id);
    await expect(service.catalog("unknown-artist")).resolves.toMatchObject({
      artist: { name: "Angela" },
      catalogState: { status: "ready", hasData: true },
    });
    expect(upstream.artist).toHaveBeenCalledOnce();
  });

  it("keeps data visible while refreshing stale data and allows an explicit retry after failure", async () => {
    let now = new Date("2026-09-08T00:00:00Z");
    const db = new FakeCatalogDb();
    const repo = new FakeJobRepository(() => new Date(now));
    const upstream = { artist: vi.fn().mockResolvedValue(fixture()) };
    const service = new ArtistCatalogService(db as never, new JobQueue(repo, { now: () => new Date(now) }), upstream, {
      now: () => new Date(now),
      ttlMs: 60_000,
      refreshCooldownMs: 10_000,
    });

    await service.catalog("angela");
    let job = await repo.claimNext(now);
    await service.runRefresh(job!.payload, job!);
    await repo.complete(job!.id);
    now = new Date(now.getTime() + 61_000);
    const stale = await service.catalog("angela");
    expect(stale).toMatchObject({ themes: [{ id: 1 }], catalogState: { status: "refreshing", hasData: true } });

    job = await repo.claimNext(now);
    job!.attempts = job!.maxAttempts - 1;
    upstream.artist.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(service.runRefresh(job!.payload, job!)).rejects.toThrow("provider unavailable");
    await repo.fail(job!.id, { state: "FAILED", nextRunAt: now, lastError: "provider unavailable", incrementAttempts: true });
    expect((await service.catalog("angela")).catalogState.status).toBe("error");

    const retry = await service.refresh("angela");
    expect(retry.catalogState.status).toBe("refreshing");
    expect((await repo.list()).filter((entry) => entry.state === "QUEUED")).toHaveLength(1);
  });

  it("tries the canonical underscore alias only after an upstream 404", async () => {
    const db = new FakeCatalogDb();
    const repo = new FakeJobRepository();
    const notFound = Object.assign(new Error("missing"), { status: 404 });
    const upstream = { artist: vi.fn().mockRejectedValueOnce(notFound).mockResolvedValueOnce(fixture("Nagi Yanagi")) };
    const service = new ArtistCatalogService(db as never, new JobQueue(repo), upstream);
    await service.catalog("nagi-yanagi");
    const job = await repo.claimNext(new Date());
    await service.runRefresh(job!.payload, job!);
    expect(upstream.artist.mock.calls.map(([slug]) => slug)).toEqual(["nagi-yanagi", "nagi_yanagi"]);
  });
});
