import { readdir, rm, stat, statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, sep } from "node:path";
import type { Pool } from "pg";
import { JobPriority, type JobQueue } from "../jobs/index.js";
import type { RecentLogStore } from "../logging.js";
import { resolveManagedMediaPath } from "../media/mediaPathSafety.js";
import type { MusicOperatorApiService, MusicOperatorAction } from "../music/operator/types.js";
import type { MusicRequestService } from "../music/requests/service.js";
import type { AdminDashboardApi, AdminMediaKind, AdminMediaVariant } from "./routes.js";

interface AdminDashboardOptions {
  pool: Pool;
  queue: JobQueue;
  requests: Pick<MusicRequestService, "trigger">;
  operator: MusicOperatorApiService;
  mediaRoot: string;
  logs: RecentLogStore;
}

export class PgAdminDashboardService implements AdminDashboardApi {
  constructor(private readonly options: AdminDashboardOptions) {}

  async overview() {
    const [counts, storage] = await Promise.all([
      this.options.pool.query(`SELECT
        (SELECT count(*) FROM users) users,
        (SELECT count(*) FROM kitsu_anime WHERE deleted_at IS NULL) anime,
        (SELECT count(*) FROM themes WHERE deleted_at IS NULL) themes,
        (SELECT count(*) FROM songs WHERE deleted_at IS NULL) songs,
        (SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')) active_jobs,
        (SELECT count(*) FROM jobs WHERE state='FAILED') failed_jobs`),
      storageUsage(this.options.mediaRoot),
    ]);
    const row = counts.rows[0];
    return { counts: { users: Number(row.users), anime: Number(row.anime), themes: Number(row.themes), songs: Number(row.songs), activeJobs: Number(row.active_jobs), failedJobs: Number(row.failed_jobs) }, storage };
  }

  async listUsers(input: { query: string | undefined; limit: number }) {
    const q = `%${input.query ?? ""}%`;
    const result = await this.options.pool.query(`SELECT u.kitsu_user_id id,u.username,u.kitsu_auth_state auth_state,u.last_sync_at,
      count(DISTINCT ds.id) session_count,count(DISTINCT le.kitsu_id) FILTER (WHERE le.deleted_at IS NULL) library_count
      FROM users u LEFT JOIN device_sessions ds ON ds.user_id=u.kitsu_user_id
      LEFT JOIN library_entries le ON le.user_id=u.kitsu_user_id
      WHERE u.username ILIKE $1 OR u.kitsu_user_id ILIKE $1
      GROUP BY u.kitsu_user_id ORDER BY u.username LIMIT $2`, [q, input.limit]);
    return result.rows.map((row) => ({ id: row.id, username: row.username, authState: row.auth_state, lastSyncAt: iso(row.last_sync_at), sessionCount: Number(row.session_count), libraryCount: Number(row.library_count) }));
  }

  async listAnime(input: { query: string | undefined; limit: number }) {
    const q = `%${input.query ?? ""}%`;
    const result = await this.options.pool.query(`SELECT k.kitsu_id,k.animethemes_anime_id,coalesce(k.title_en,k.title,k.title_romaji,k.kitsu_id) title,k.mapping_state,
      (SELECT count(*) FROM themes t WHERE t.animethemes_anime_id=k.animethemes_anime_id AND t.deleted_at IS NULL) theme_count,
      (SELECT count(*) FROM themes t JOIN media_files m ON m.kind='AUDIO' AND m.variant='SHORT' AND m.ref_id=t.id::text AND m.state='READY' WHERE t.animethemes_anime_id=k.animethemes_anime_id AND t.deleted_at IS NULL) tv_ready,
      (SELECT count(*) FROM themes t JOIN theme_full_songs tf ON tf.theme_id=t.id JOIN media_files m ON m.kind='AUDIO' AND m.variant='ORIGINAL' AND m.ref_id=('song:'||tf.song_id::text) AND m.state='READY' WHERE t.animethemes_anime_id=k.animethemes_anime_id AND t.deleted_at IS NULL) full_ready
      FROM kitsu_anime k WHERE k.deleted_at IS NULL AND (coalesce(k.title_en,'') ILIKE $1 OR coalesce(k.title,'') ILIKE $1 OR coalesce(k.title_romaji,'') ILIKE $1 OR k.kitsu_id ILIKE $1)
      ORDER BY coalesce(k.title_en,k.title,k.title_romaji,k.kitsu_id) LIMIT $2`, [q, input.limit]);
    return result.rows.map((row) => ({ kitsuId: row.kitsu_id, animeThemesId: row.animethemes_anime_id, title: row.title, mapped: row.mapping_state === "MAPPED", themeCount: Number(row.theme_count), tvReady: Number(row.tv_ready), fullReady: Number(row.full_ready) }));
  }

  async listSongs(input: { query: string | undefined; limit: number }) {
    const q = `%${input.query ?? ""}%`;
    const result = await this.options.pool.query(`SELECT s.id,s.title,s.artist_credit,s.updated_at,m.state media_state,m.byte_size
      FROM songs s LEFT JOIN media_files m ON m.kind='AUDIO' AND m.variant='ORIGINAL' AND m.ref_id=('song:'||s.id::text)
      WHERE s.deleted_at IS NULL AND (s.title ILIKE $1 OR s.artist_credit ILIKE $1)
      ORDER BY s.updated_at DESC,s.id DESC LIMIT $2`, [q, input.limit]);
    return result.rows.map((row) => ({ id: Number(row.id), title: row.title, artist: row.artist_credit, mediaState: row.media_state ?? "MISSING", byteSize: row.byte_size === null ? null : Number(row.byte_size), updatedAt: iso(row.updated_at) }));
  }

  listLogs(input: { level: string | undefined; limit: number }) { return this.options.logs.list(input).map((entry) => ({ ...entry })); }
  listRequests() { return this.options.operator.listRequests(); }
  async listJobs() { return (await this.options.queue.list(undefined, 250)).map((job) => ({ ...job, nextRunAt: job.nextRunAt.toISOString(), createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString() })); }

  async syncUser(userId: string) {
    await this.requireUser(userId);
    const job = await this.options.queue.enqueue({ type: "KITSU_FULL_SYNC", priority: JobPriority.HIGH, payload: { userId, full: true }, dedupeKey: `KITSU_SYNC:${userId}` });
    return { queued: true, jobId: job.id };
  }

  async revokeUserSessions(userId: string) {
    await this.requireUser(userId);
    const result = await this.options.pool.query("DELETE FROM device_sessions WHERE user_id=$1", [userId]);
    return { revoked: result.rowCount ?? 0 };
  }

  async refreshAnime(kitsuId: string) {
    await this.requireAnime(kitsuId);
    const job = await this.options.queue.enqueue({ type: "MAP_THEMES", priority: JobPriority.HIGH, payload: { kitsuIds: [kitsuId] }, dedupeKey: `MAP_THEMES:ADMIN:${kitsuId}` });
    return { queued: true, jobId: job.id };
  }

  async requestAnimeMusic(kitsuId: string) {
    await this.requireAnime(kitsuId);
    const userId = await this.requireMusicRequestActor(kitsuId);
    const result = await this.options.requests.trigger(userId, kitsuId, "DEBUG_USER");
    return { requestId: result.request.id, replayed: result.replayed };
  }

  async reimportAnimeFullSize(kitsuId: string) {
    await this.requireAnime(kitsuId);
    const userId = await this.requireMusicRequestActor(kitsuId);
    const job = await this.options.queue.enqueue({
      type: "REIMPORT_AMF_FULL_SIZE",
      priority: JobPriority.HIGH,
      payload: { kitsuId, userId, requestId: `admin-reimport-${randomUUID()}` },
      dedupeKey: `REIMPORT_AMF_FULL_SIZE:${kitsuId}`,
      maxAttempts: 8,
    });
    return { queued: true, jobId: job.id };
  }

  async refreshThemeMedia(kitsuId: string) {
    const anime = await this.requireAnime(kitsuId);
    if (!anime.animethemes_anime_id) throw new Error("Anime is not mapped to AnimeThemes.");
    const themes = await this.options.pool.query("SELECT id FROM themes WHERE animethemes_anime_id=$1 AND deleted_at IS NULL", [anime.animethemes_anime_id]);
    for (const row of themes.rows) {
      await this.removeMedia("AUDIO", String(row.id), "SHORT");
      await this.options.queue.enqueue({ type: "FETCH_AUDIO", priority: JobPriority.HIGH, payload: { themeId: Number(row.id) }, dedupeKey: `FETCH_AUDIO:${row.id}` });
    }
    return { queued: themes.rows.length };
  }

  async removeThemeMedia(kitsuId: string) {
    const anime = await this.requireAnime(kitsuId);
    if (!anime.animethemes_anime_id) throw new Error("Anime is not mapped to AnimeThemes.");
    const themes = await this.options.pool.query("SELECT id FROM themes WHERE animethemes_anime_id=$1 AND deleted_at IS NULL", [anime.animethemes_anime_id]);
    let removedFiles = 0; let removedBytes = 0;
    for (const row of themes.rows) {
      const removed = await this.removeMedia("AUDIO", String(row.id), "SHORT");
      removedFiles += Number(removed.removedFiles); removedBytes += Number(removed.removedBytes);
    }
    return { removedFiles, removedBytes };
  }

  async removeMedia(kind: AdminMediaKind, refId: string, variant: AdminMediaVariant) {
    const result = await this.options.pool.query("SELECT file_path,byte_size FROM media_files WHERE kind=$1 AND ref_id=$2 AND variant=$3 LIMIT 1", [kind, refId, variant]);
    const row = result.rows[0];
    if (!row) return { removedFiles: 0, removedBytes: 0 };
    if (row.file_path) {
      const path = await resolveManagedMediaPath(this.options.mediaRoot, row.file_path);
      await rm(path, { force: true });
    }
    await this.options.pool.query(`UPDATE media_files SET state='MISSING',file_path=NULL,byte_size=NULL,sha256=NULL,error_message=NULL,updated_at=now() WHERE kind=$1 AND ref_id=$2 AND variant=$3`, [kind, refId, variant]);
    return { removedFiles: row.file_path ? 1 : 0, removedBytes: Number(row.byte_size ?? 0) };
  }

  async clearCache(category: "artwork" | "temporary" | "all") {
    let removedFiles = 0; let removedBytes = 0;
    if (category === "artwork" || category === "all") {
      const rows = await this.options.pool.query("SELECT kind,ref_id,variant,file_path,byte_size FROM media_files WHERE kind IN ('ANIME_POSTER','ANIME_COVER','ARTIST_IMAGE')");
      for (const row of rows.rows) {
        const result = await this.removeMedia(row.kind, row.ref_id, row.variant);
        removedFiles += Number(result.removedFiles); removedBytes += Number(result.removedBytes);
      }
    }
    if (category === "temporary" || category === "all") {
      const temp = await resolveManagedMediaPath(this.options.mediaRoot, join("audio", "tmp"));
      const size = await directorySize(temp);
      await rm(temp, { recursive: true, force: true });
      removedBytes += size.bytes; removedFiles += size.files;
    }
    return { removedFiles, removedBytes };
  }

  async retryJob(jobId: number) {
    const job = await this.options.queue.retryJob(jobId);
    if (!job) throw new Error("Job not found or not retryable.");
    return { queued: true, jobId: job.id };
  }

  operateBatch(batchId: string, action: "retry" | "cancel" | "reprocess") {
    const actions: Record<typeof action, MusicOperatorAction> = { retry: "RETRY_PROVIDER", cancel: "CANCEL_PROVIDER", reprocess: "REPROCESS_PROVIDER" };
    return this.options.operator.enqueueAction(batchId, actions[action]);
  }

  private async requireUser(userId: string) {
    const result = await this.options.pool.query("SELECT kitsu_user_id FROM users WHERE kitsu_user_id=$1", [userId]);
    if (!result.rows[0]) throw new Error("User not found.");
    return result.rows[0];
  }

  private async requireAnime(kitsuId: string) {
    const result = await this.options.pool.query("SELECT kitsu_id,animethemes_anime_id FROM kitsu_anime WHERE kitsu_id=$1 AND deleted_at IS NULL", [kitsuId]);
    if (!result.rows[0]) throw new Error("Anime not found.");
    return result.rows[0];
  }

  private async requireMusicRequestActor(kitsuId: string): Promise<string> {
    const actor = await this.options.pool.query(`SELECT u.kitsu_user_id FROM users u
      LEFT JOIN library_entries le ON le.user_id=u.kitsu_user_id AND le.kitsu_id=$1 AND le.deleted_at IS NULL
      ORDER BY (le.kitsu_id IS NOT NULL) DESC,u.created_at LIMIT 1`, [kitsuId]);
    if (!actor.rows[0]) throw new Error("A real user must exist before an admin can request music.");
    return actor.rows[0].kitsu_user_id;
  }
}

async function storageUsage(mediaRoot: string) {
  const root = await statfs(mediaRoot);
  const usage = { totalBytes: 0, tvSongsBytes: 0, fullSongsBytes: 0, artworkBytes: 0, cacheBytes: 0, capacityBytes: root.blocks * root.bsize, freeBytes: root.bavail * root.bsize };
  await walk(mediaRoot, async (path, size) => {
    const rel = relative(mediaRoot, path).split(sep).join("/"); usage.totalBytes += size;
    if (/^audio\/songs\//.test(rel)) usage.fullSongsBytes += size;
    else if (/^audio\/[^/]+\.ogg$/i.test(rel)) usage.tvSongsBytes += size;
    else if (rel.startsWith("images/")) usage.artworkBytes += size;
    else usage.cacheBytes += size;
  });
  return usage;
}

async function directorySize(path: string) { let bytes = 0; let files = 0; await walk(path, async (_file, size) => { bytes += size; files++; }); return { bytes, files }; }
async function walk(root: string, visit: (path: string, size: number) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await walk(path, visit);
    else if (entry.isFile()) { const info = await stat(path); await visit(path, info.size); }
  }
}
function iso(value: Date | string | null): string | null { return value ? new Date(value).toISOString() : null; }
