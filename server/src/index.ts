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
import { createJsonStdoutLogger } from "./logging.js";
import {
  AnimeMusicFetcherClient,
  createAnimeMusicFetcherUpstreamHttp,
  createMusicRequestHandlers,
  MusicRequestService,
  PgMusicRequestRepository,
} from "./music/index.js";
import {
  createFetchMediaHandlers,
  DrizzleMediaCatalogLookup,
  DrizzleMediaFileRepo,
  InteractiveMediaActivity,
  MediaStore,
} from "./media/index.js";
import {
  createSyncJobHandlers,
  DeviceActivitySyncTrigger,
  DrizzleSyncRepository,
  kitsuSyncDedupeKey,
  LibrarySyncPipeline,
  SyncScheduler,
} from "./sync/index.js";

const config = loadConfig();
const externalLogger = createJsonStdoutLogger();

const amfHttp = createAnimeMusicFetcherUpstreamHttp({ logger: externalLogger });
const amfClient = new AnimeMusicFetcherClient({ http: amfHttp });

const { pool, db } = createDb(config.DATABASE_URL);

await runMigrations(db);

await mkdir(join(config.MEDIA_ROOT, "audio", "tmp"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "anime"), { recursive: true });
await mkdir(join(config.MEDIA_ROOT, "images", "artists"), { recursive: true });

const jobQueue = new JobQueue(new PgJobRepository(pool));
const musicRequestRepo = new PgMusicRequestRepository(pool);
const musicRequestService = new MusicRequestService({ repo: musicRequestRepo, queue: jobQueue });
const musicRequestHandlers = createMusicRequestHandlers({ repo: musicRequestRepo, queue: jobQueue, client: amfClient });
const syncRepo = new DrizzleSyncRepository(db);

// Each upstream host shares one politeness budget (bucket) and one breaker
// across two lanes: "interactive" for request/response paths a client is
// waiting on, "background" for job-queue work. Background requests yield the
// budget whenever interactive traffic wants it, so cache hydration can never
// slow down on-demand serving.
const kitsuBucket = new TokenBucket({ capacity: 2, refillPerSecond: 2 });
const kitsuBreaker = new CircuitBreaker();
const kitsuHttp = new UpstreamHttp({
  bucket: kitsuBucket,
  breaker: kitsuBreaker,
  name: "kitsu",
  logger: externalLogger,
});
const kitsuBackgroundHttp = new UpstreamHttp({
  bucket: kitsuBucket,
  breaker: kitsuBreaker,
  name: "kitsu",
  logger: externalLogger,
  lane: "background",
});

const animeThemesBucket = new TokenBucket({ capacity: 3, refillPerSecond: 3 });
const animeThemesBreaker = new CircuitBreaker();
// Cloudflare hard-blocks with 403 (and occasionally 451); treat repeated
// blocks as breaker failures so the queue stops hammering a blocked origin.
const animeThemesBreakerStatuses = [403, 451];
const animeThemesHttp = new UpstreamHttp({
  bucket: animeThemesBucket,
  breaker: animeThemesBreaker,
  name: "animethemes",
  logger: externalLogger,
  breakerStatuses: animeThemesBreakerStatuses,
});
const animeThemesBackgroundHttp = new UpstreamHttp({
  bucket: animeThemesBucket,
  breaker: animeThemesBreaker,
  name: "animethemes",
  logger: externalLogger,
  breakerStatuses: animeThemesBreakerStatuses,
  lane: "background",
});

// Poster/cover art lives on image CDNs (media.kitsu.app, i.animethemes.moe),
// not the AnimeThemes API host — give it its own budget and breaker so an API
// block or a busy audio queue can never take cover art down with it.
const imagesBucket = new TokenBucket({ capacity: 4, refillPerSecond: 4 });
const imagesBreaker = new CircuitBreaker();
const imagesHttp = new UpstreamHttp({
  bucket: imagesBucket,
  breaker: imagesBreaker,
  name: "media-images",
  logger: externalLogger,
});
const imagesBackgroundHttp = new UpstreamHttp({
  bucket: imagesBucket,
  breaker: imagesBreaker,
  name: "media-images",
  logger: externalLogger,
  lane: "background",
});

const kitsuClient = new KitsuClient({ http: kitsuHttp });
const kitsuBackgroundClient = new KitsuClient({ http: kitsuBackgroundHttp });
const kitsuAuthClient =
  config.KITSU_AUTH_MODE === "real"
    ? new RealKitsuAuthClient({
        http: kitsuHttp,
        clientId: config.KITSU_CLIENT_ID,
        clientSecret: config.KITSU_CLIENT_SECRET,
      })
    : new StubKitsuAuthClient();
const animeThemesClient = new AnimeThemesClient({
  http: animeThemesHttp,
  baseUrl: config.ANIMETHEMES_BASE_URL,
});
const animeThemesBackgroundClient = new AnimeThemesClient({
  http: animeThemesBackgroundHttp,
  baseUrl: config.ANIMETHEMES_BASE_URL,
});
const animeThemesFetch = (url: string | URL | Request, init?: RequestInit) =>
  animeThemesHttp.request(String(url), init);
const animeThemesBackgroundFetch = (url: string | URL | Request, init?: RequestInit) =>
  animeThemesBackgroundHttp.request(String(url), init);
const imagesFetch = (url: string | URL | Request, init?: RequestInit) =>
  imagesHttp.request(String(url), init);
const imagesBackgroundFetch = (url: string | URL | Request, init?: RequestInit) =>
  imagesBackgroundHttp.request(String(url), init);

const syncPipeline = new LibrarySyncPipeline({
  repo: syncRepo,
  kitsu: kitsuBackgroundClient,
  kitsuAuth: kitsuAuthClient,
  animeThemes: animeThemesBackgroundClient,
  queue: jobQueue,
});
const mediaStore = new MediaStore({
  mediaRoot: config.MEDIA_ROOT,
  repo: new DrizzleMediaFileRepo(db),
  fetch: animeThemesBackgroundFetch,
  imageFetch: imagesBackgroundFetch,
  logger: externalLogger,
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
await musicRequestService.recover();
const syncHandlers = createSyncJobHandlers(syncPipeline);
// Background hydration waits until on-demand media traffic has been quiet.
const mediaActivity = new InteractiveMediaActivity();
const worker = new JobWorker(jobQueue, {
  handlers: { ...fetchHandlers, ...syncHandlers, ...musicRequestHandlers },
  maintenanceFetchDelayMs: config.AUDIO_BACKFILL_DELAY_SECONDS * 1000,
  holdMaintenanceWork: () => !mediaActivity.isQuiet(),
});
worker.start();
// A second worker restricted to urgent/high jobs so a client-facing fetch is
// never queued behind a long-running background download on the main worker.
const interactiveWorker = new JobWorker(jobQueue, {
  handlers: { ...fetchHandlers, ...syncHandlers },
  maxPriority: JobPriority.HIGH,
});
interactiveWorker.start();

const syncScheduler = new SyncScheduler({
  queue: jobQueue,
  repo: syncRepo,
  pipeline: syncPipeline,
  mediaRoot: config.MEDIA_ROOT,
  syncIntervalMinutes: config.SYNC_INTERVAL_MINUTES,
});
syncScheduler.start();

const clientApi = new DrizzleClientApiService(
  db,
  jobQueue,
  undefined,
  externalLogger,
  config.MUSIC_CATALOG_ENABLED,
);
const deviceActivitySync = new DeviceActivitySyncTrigger({ queue: jobQueue });

const app = buildApp({
  authService: new AuthService(
    new DrizzleAuthRepo(db),
    kitsuAuthClient,
  ),
  health: {
    pingDb: async () => {
      await pool.query("SELECT 1");
    },
    mediaRoot: config.MEDIA_ROOT,
  },
  jobs: jobQueue,
  clientApi,
  legacyLibraryImport: clientApi,
  musicRequests: musicRequestService,
  mediaApi: new MediaStreamingService({
    repo: new DrizzleMediaApiRepository(db),
    queue: jobQueue,
    mediaRoot: config.MEDIA_ROOT,
    fetch: animeThemesFetch,
    imageFetch: imagesFetch,
    logger: externalLogger,
    activity: mediaActivity,
    musicCatalogEnabled: config.MUSIC_CATALOG_ENABLED,
  }),
  syncApi: new JobSyncApiService(jobQueue),
  proxyApi: new CachedProxyService({
    upstream: new UpstreamProxyService(animeThemesClient, kitsuClient, syncRepo),
    musicSearch: (userId, query) => clientApi.searchMusic(userId, query),
  }),
  onLogin: async (result) => {
    // New users and long-dormant libraries get a FULL sync; recently synced
    // users just get a HIGH-priority delta ("did they add something since the
    // server's last auto-sync?"). Full sync never touches playlists/prefs.
    const type = result.syncMode === "DELTA" ? "KITSU_DELTA_SYNC" : "KITSU_FULL_SYNC";
    await jobQueue.enqueue({
      type,
      priority: JobPriority.HIGH,
      payload: { userId: result.user.kitsuUserId },
      dedupeKey: kitsuSyncDedupeKey(result.user.kitsuUserId),
    });
  },
  onAuthenticatedRequest: (user) => deviceActivitySync.onUserActivity(user),
  logger: true,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  syncScheduler.stop();
  worker.stop();
  interactiveWorker.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: "0.0.0.0" });
