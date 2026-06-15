import { opendir, stat, statfs as nodeStatfs } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface ServerStatus {
  generatedAt: number;
  disk: {
    mediaRoot: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    availablePercent: number;
  };
  mediaStorage: {
    totalBytes: number;
    fileCount: number;
    byDirectory: StorageBreakdown[];
    byExtension: ExtensionBreakdown[];
  };
  catalog: {
    users: number;
    anime: number;
    songs: number;
    artists: number;
    playlists: number;
    mediaFiles: number;
    readyMediaFiles: number;
    images: number;
    audio: number;
    video: number;
  };
  mediaByKind: MediaKindStatus[];
}

export interface StorageBreakdown {
  name: string;
  bytes: number;
  fileCount: number;
}

export interface ExtensionBreakdown {
  extension: string;
  bytes: number;
  fileCount: number;
}

export interface MediaKindStatus {
  kind: string;
  total: number;
  ready: number;
  bytes: number;
}

interface QueryResult {
  rows: Record<string, unknown>[];
}

type QueryFn = (text: string, values?: unknown[]) => Promise<QueryResult>;

interface StatFsLike {
  bsize: number;
  blocks: number;
  bavail: number;
}

export interface StatusDashboardServiceDeps {
  mediaRoot: string;
  query: QueryFn;
  statfs?: (path: string) => Promise<StatFsLike>;
  now?: () => Date;
}

export class PgStatusDashboardService {
  private readonly mediaRoot: string;
  private readonly query: QueryFn;
  private readonly statfs: (path: string) => Promise<StatFsLike>;
  private readonly now: () => Date;

  constructor(deps: StatusDashboardServiceDeps) {
    this.mediaRoot = deps.mediaRoot;
    this.query = deps.query;
    this.statfs = deps.statfs ?? nodeStatfs;
    this.now = deps.now ?? (() => new Date());
  }

  async getStatus(): Promise<ServerStatus> {
    const [disk, mediaStorage, catalog, mediaByKind] = await Promise.all([
      this.readDiskStats(),
      readMediaStorage(this.mediaRoot),
      this.readCatalogCounts(),
      this.readMediaByKind(),
    ]);

    return {
      generatedAt: this.now().getTime(),
      disk,
      mediaStorage,
      catalog,
      mediaByKind,
    };
  }

  private async readDiskStats(): Promise<ServerStatus["disk"]> {
    const stats = await this.statfs(this.mediaRoot);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(totalBytes - freeBytes, 0);
    const availablePercent = totalBytes === 0 ? 0 : Math.round((freeBytes / totalBytes) * 1000) / 10;

    return {
      mediaRoot: this.mediaRoot,
      totalBytes,
      freeBytes,
      usedBytes,
      availablePercent,
    };
  }

  private async readCatalogCounts(): Promise<ServerStatus["catalog"]> {
    const result = await this.query(`
      select
        (select count(*) from users) as "users",
        (select count(*) from kitsu_anime where deleted_at is null) as "anime",
        (select count(*) from themes where deleted_at is null) as "songs",
        (select count(*) from artists) as "artists",
        (select count(*) from playlists where deleted_at is null) as "playlists",
        (select count(*) from media_files) as "mediaFiles",
        (select count(*) from media_files where state = 'READY') as "readyMediaFiles",
        (select count(*) from media_files where kind in ('ANIME_POSTER', 'ANIME_COVER', 'ARTIST_IMAGE')) as "images",
        (select count(*) from media_files where kind = 'AUDIO') as "audio",
        (select count(*) from media_files where kind = 'VIDEO') as "video"
    `);
    const row = result.rows[0] ?? {};
    return {
      users: toNumber(row.users),
      anime: toNumber(row.anime),
      songs: toNumber(row.songs),
      artists: toNumber(row.artists),
      playlists: toNumber(row.playlists),
      mediaFiles: toNumber(row.mediaFiles),
      readyMediaFiles: toNumber(row.readyMediaFiles),
      images: toNumber(row.images),
      audio: toNumber(row.audio),
      video: toNumber(row.video),
    };
  }

  private async readMediaByKind(): Promise<MediaKindStatus[]> {
    const result = await this.query(`
      select
        kind,
        count(*) as total,
        count(*) filter (where state = 'READY') as ready,
        coalesce(sum(byte_size), 0) as bytes
      from media_files
      group by kind
      order by kind
    `);

    return result.rows.map((row) => ({
      kind: String(row.kind ?? "UNKNOWN"),
      total: toNumber(row.total),
      ready: toNumber(row.ready),
      bytes: toNumber(row.bytes),
    }));
  }
}

async function readMediaStorage(mediaRoot: string): Promise<ServerStatus["mediaStorage"]> {
  const byDirectory = new Map<string, StorageBreakdown>();
  const byExtension = new Map<string, StorageBreakdown>();
  let totalBytes = 0;
  let fileCount = 0;

  async function walk(dir: string): Promise<void> {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const fileHandle = await stat(fullPath);
      const bytes = fileHandle.size;
      totalBytes += bytes;
      fileCount += 1;

      const topLevel = relative(mediaRoot, fullPath).split(/[\\/]/)[0] || "(root)";
      addBreakdown(byDirectory, topLevel, bytes);

      const extension = extname(entry.name).toLowerCase() || "(none)";
      addBreakdown(byExtension, extension, bytes);
    }
  }

  try {
    await walk(mediaRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  return {
    totalBytes,
    fileCount,
    byDirectory: sortBreakdowns(byDirectory),
    byExtension: sortBreakdowns(byExtension).map((row) => ({
      extension: row.name,
      bytes: row.bytes,
      fileCount: row.fileCount,
    })),
  };
}

function addBreakdown(map: Map<string, StorageBreakdown>, name: string, bytes: number): void {
  const current = map.get(name);
  if (current) {
    current.bytes += bytes;
    current.fileCount += 1;
    return;
  }
  map.set(name, { name, bytes, fileCount: 1 });
}

function sortBreakdowns(map: Map<string, StorageBreakdown>): StorageBreakdown[] {
  return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}
