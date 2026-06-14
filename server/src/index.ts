import { mkdir } from "node:fs/promises";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { AnimeThemesClient } from "./animethemes/client.js";
import { DrizzleClientApiService } from "./api/drizzleClientApiService.js";
import { DrizzleMediaApiRepository } from "./api/drizzleMediaApiRepository.js";
import { JobSyncApiService } from "./api/jobSyncApiService.js";
import { MediaStreamingService } from "./api/mediaRoutes.js";
import { CachedProxyService } from "./api/proxyRoutes.js";
import { UpstreamProxyService } from "./api/upstreamProxyService.js";
import { AuthService } from "./auth/service.js";
import { DrizzleAuthRepo } from "./auth/drizzleAuthRepo.js";
import { StubKitsuAuthClient } from "./auth/stubKitsuAuthClient.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { CircuitBreaker } from "./http/circuitBreaker.js";
import { TokenBucket } from "./http/tokenBucket.js";
import { UpstreamHttp } from "./http/upstream.js";
import { JobPriority, JobQueue, JobWorker, PgJobRepository } from "./jobs/index.js";
import { RealKitsuAuthClient } from "./kitsu/kitsuAuthClient.js";
import { KitsuClient } from "./kitsu/kitsuClient.js";
import {
  createFetchMediaHandlers,
  DrizzleMediaCatalogLookup,
  DrizzleMediaFileRepo,
  MediaStore,
} from "./media/index.js";
import {
  createSyncJobHandlers,
  DrizzleSyncRepository,
  LibrarySyncPipeline,
  SyncScheduler,
} from "./sync/index.js";

const config = loadConfig();

const { pool, db } = createDb(config.DATABASE_URL);

await runMigrations(db);

await mkdir(join(config.MEDIA_ROOT, "audio", "tmp"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "anime"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "artists"), { recursive: true });

const jobQueue = new JobQueue(new PgJobRepository(pool));
const syncRepo = new DrizzleSyncRepository(db);
const kitsuHttp = new UpstreamHttp({
  bucket: new TokenBucket({ capacity: 2, refillPerSecond: 2 }),
  breaker: new CircuitBreaker(),
  name: "kitsu",
});
const animeThemesHttp = new UpstreamHttp({
  bucket: new TokenBucket({ capacity: 3, refillPerSecond: 3 }),
  breaker: new CircuitBreaker(),
  name: "animethemes",
  // Cloudflare hard-blocks with 403 (and occasionally 451); treat repeated
  // blocks as breaker failures so the queue stops hammering a blocked origin.
  breakerStatuses: [403, 451],
});
const kitsuClient = new KitsuClient({ http: kitsuHttp });
const animeThemesClient = new AnimeThemesClient({
  http: animeThemesHttp,
  baseUrl: config.ANIMETHEMES_BASE_URL,
});
const syncPipeline = new LibrarySyncPipeline({
  repo: syncRepo,
  kitsu: kitsuClient,
  animeThemes: animeThemesClient,
  queue: jobQueue,
});
const mediaStore = new MediaStore({
  mediaRoot: config.MEDIA_ROOT,
  repo: new DrizzleMediaFileRepo(db),
});
const fetchHandlers = createFetchMediaHandlers({
  mediaStore,
  catalog: new DrizzleMediaCatalogLookup(db),
  getDiskFreeBytes: async () => {
    const stats = await statfs(config.MEDIA_ROOT);
    return stats.bavail * stats.bsize;
  },
});
await jobQueue.recoverRunningJobs();
const syncHandlers = createSyncJobHandlers(syncPipeline);
const worker = new JobWorker(jobQueue, {
  handlers: { ...fetchHandlers, ...syncHandlers },
  maintenanceFetchDelayMs: config.AUDIO_BACKFILL_DELAY_SECONDS * 1000,
});
worker.start();

const syncScheduler = new SyncScheduler({
  queue: jobQueue,
  repo: syncRepo,
  pipeline: syncPipeline,
  mediaRoot: config.MEDIA_ROOT,
  syncIntervalMinutes: config.SYNC_INTERVAL_MINUTES,
});
syncScheduler.start();

const app = buildApp({
  authService: new AuthService(
    new DrizzleAuthRepo(db),
    config.KITSU_AUTH_MODE === "real"
      ? new RealKitsuAuthClient({
          http: kitsuHttp,
          clientId: config.KITSU_CLIENT_ID,
          clientSecret: config.KITSU_CLIENT_SECRET,
        })
      : new StubKitsuAuthClient(),
  ),
  health: {
    pingDb: async () => {
      await pool.query("SELECT 1");
    },
    mediaRoot: config.MEDIA_ROOT,
  },
  jobs: jobQueue,
  clientApi: new DrizzleClientApiService(db, jobQueue),
  mediaApi: new MediaStreamingService({
    repo: new DrizzleMediaApiRepository(db),
    queue: jobQueue,
    mediaRoot: config.MEDIA_ROOT,
  }),
  syncApi: new JobSyncApiService(jobQueue),
  proxyApi: new CachedProxyService({
    upstream: new UpstreamProxyService(animeThemesClient, kitsuClient, syncRepo),
  }),
  onLogin: async (result) => {
    if (!result.isNewUser) return;
    await jobQueue.enqueue({
      type: "KITSU_FULL_SYNC",
      priority: JobPriority.HIGH,
      payload: { userId: result.user.kitsuUserId },
      dedupeKey: `KITSU_FULL_SYNC:${result.user.kitsuUserId}`,
    });
  },
  logger: true,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  syncScheduler.stop();
  worker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: "0.0.0.0" });
