import { readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { KitsuAuthError } from "../auth/types.js";
import { JobPriority } from "../jobs/types.js";
import type { AnimeThemeEntry, AnimeThemesLookupResult } from "../animethemes/types.js";
import type { KitsuAnimeEntry, KitsuGenre } from "../kitsu/types.js";
import type { KitsuCatalogRecord, LibrarySyncPipelineDeps, MapThemesInput, SyncJobInput } from "./types.js";
import { resolveManagedMediaPath } from "../media/mediaPathSafety.js";

const DEFAULT_MAPPING_BATCH_SIZE = 50;
// Kept well under the MAP_THEMES job timeout so a single invocation always
// checkpoints (re-enqueues remaining work) before the worker would time it out.
const DEFAULT_MAPPING_TIME_BUDGET_MS = 45_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export class LibrarySyncPipeline {
  private readonly now: () => Date;
  private readonly mappingBatchSize: number;
  private readonly mappingTimeBudgetMs: number;

  constructor(private readonly deps: LibrarySyncPipelineDeps) {
    this.now = deps.now ?? (() => new Date());
    this.mappingBatchSize = deps.mappingBatchSize ?? DEFAULT_MAPPING_BATCH_SIZE;
    this.mappingTimeBudgetMs = deps.mappingTimeBudgetMs ?? DEFAULT_MAPPING_TIME_BUDGET_MS;
  }

  async runKitsuSync(input: SyncJobInput): Promise<void> {
    const user = await this.deps.repo.getUserSyncAuth(input.userId);
    if (!user) {
      await this.updateProgress(input.job.id, { phase: "SKIPPED", reason: "USER_NOT_FOUND" });
      return;
    }
    if (user.kitsuAuthState === "REAUTH_REQUIRED" || !user.accessToken) {
      await this.updateProgress(input.job.id, {
        phase: "SKIPPED",
        reason: "REAUTH_REQUIRED",
      });
      return;
    }

    const accessToken = await this.accessTokenForSync(input.userId, input.job.id, user);
    if (!accessToken) return;

    // Anchor the status watermark at the beginning of the upstream read. Any
    // Kitsu edit made while the pages are being fetched then remains newer
    // than this value and is picked up by the next delta/reconciliation.
    const syncStartedAt = this.now();
    await this.updateProgress(input.job.id, { phase: "SYNCING_LIBRARY" });
    const fetchedEntries = input.full
      ? await this.deps.kitsu.getLibraryEntries(input.userId, { accessToken, requireComplete: true })
      : await this.deps.kitsu.getLibraryEntriesUpdatedSince(
          input.userId,
          (user.lastStatusSyncAt ?? new Date(0)).toISOString(),
          accessToken,
        );
    // Full scans are authoritative for tombstones, but only entries changed
    // since the previous status watermark need catalog/library upserts. This
    // keeps a ten-minute reconciliation cheap for large libraries.
    const entries = input.full && input.reconcileOnly
      ? await this.entriesChangedSince(input.userId, fetchedEntries, user.lastStatusSyncAt)
      : fetchedEntries;

    await this.deps.repo.upsertKitsuAnime(entries);
    await this.deps.repo.upsertLibraryEntries(input.userId, entries);
    if (input.full) {
      await this.deps.repo.tombstoneMissingLibraryEntries(
        input.userId,
        fetchedEntries.map((entry) => entry.id),
      );
    }

    // A full reconciliation is intentionally frequent so removals are
    // tombstoned promptly.  Re-running AnimeThemes mapping and category
    // requests for every unchanged library entry would turn that freshness
    // check into expensive background churn, so only unmapped/new catalog
    // rows receive those follow-ups.
    const catalogWorkEntries = await this.entriesNeedingCatalogWork(entries, input.reconcileOnly === true);
    await this.upsertGenres(catalogWorkEntries);
    await this.enqueueFollowUps(input.userId, catalogWorkEntries, input.reconcileOnly === true && entries.length > 0);
    await this.deps.repo.refreshAutoPlaylists?.(input.userId);
    // Automatic full-song policy eligibility is broader than theme mapping:
    // an already-mapped anime can become eligible after a library add/status
    // change, so notify the policy reconciler for every changed library row.
    // Mapping emits a second notification after new themes are persisted.
    if (entries.length > 0) {
      await this.deps.onLibraryChanged?.(input.userId).catch(() => undefined);
    }

    const completedAt = this.now();
    await this.deps.repo.updateUserSyncTimestamps(input.userId, {
      lastSyncAt: completedAt,
      lastStatusSyncAt: syncStartedAt,
    });
    await this.updateProgress(input.job.id, {
      phase: "DONE",
      total: fetchedEntries.length,
      updated: entries.length,
      completedAt: completedAt.getTime(),
    });
  }

  async runMapThemes(input: MapThemesInput): Promise<void> {
    const kitsuIds = unique(input.kitsuIds);
    const catalog = new Map(
      ((await this.deps.repo.getKitsuAnimeForMapping?.(kitsuIds)) ?? []).map((record) => [
        record.kitsuId,
        record,
      ]),
    );
    const allMapped = new Map<string, number>();
    const startedAt = this.now().getTime();

    await this.updateProgress(input.job.id, {
      phase: "MAPPING_THEMES",
      total: kitsuIds.length,
      processed: 0,
    });

    for (let offset = 0; offset < kitsuIds.length; offset += this.mappingBatchSize) {
      const batch = kitsuIds.slice(offset, offset + this.mappingBatchSize);
      const batchMapped = new Map<string, number>();
      const batchThemes: AnimeThemeEntry[] = [];
      await this.mapBatch(batch, catalog, batchMapped, batchThemes);
      await this.flushMappings(batchThemes, batchMapped);
      // A library sync queues this mapping work before the first refresh can
      // run. Refresh after each persisted mapping batch so newly mapped anime
      // become visible to auto and dynamic playlists immediately, even when a
      // long mapping job yields before its final batch. The queued refresh at
      // the end remains a recovery path for adapters where this hook is absent.
      if (input.userId && batchMapped.size > 0) {
        await this.deps.repo.refreshAutoPlaylists?.(input.userId);
      }
      for (const [kitsuId, animeThemesId] of batchMapped) {
        allMapped.set(kitsuId, animeThemesId);
      }

      const processed = Math.min(offset + batch.length, kitsuIds.length);
      await this.updateProgress(input.job.id, {
        phase: "MAPPING_THEMES",
        total: kitsuIds.length,
        processed,
      });

      // Checkpoint before the job timeout: hand remaining work to a fresh
      // MAP_THEMES so title-search-heavy libraries progress across many short
      // invocations instead of one long one that times out and restarts.
      const remaining = kitsuIds.slice(processed);
      const overTimeBudget = this.now().getTime() - startedAt >= this.mappingTimeBudgetMs;
      if (remaining.length > 0 && (overTimeBudget || (await this.deps.queue.hasUrgentQueued()))) {
        await this.deps.queue.enqueue({
          type: "MAP_THEMES",
          priority: JobPriority.NORMAL,
          payload: payloadWithOptionalUser({ kitsuIds: remaining }, input.userId),
          dedupeKey: mapThemesDedupeKey(input.userId, remaining),
        });
        await this.updateProgress(input.job.id, {
          phase: "YIELDED",
          remaining: remaining.length,
          reason: overTimeBudget ? "TIME_BUDGET" : "URGENT_WORK",
        });
        return;
      }
    }

    // Wait until the final mapping continuation has persisted every batch
    // before triggering the automatic music scan. Playlist materialization is
    // still refreshed per batch above, while the policy sees the complete
    // mapped library and cannot run between two yielded mapping jobs.
    if (input.userId && allMapped.size > 0) {
      await this.deps.onLibraryChanged?.(input.userId).catch(() => undefined);
    }

    const unmatched = kitsuIds.filter((id) => !allMapped.has(id));
    if (unmatched.length > 0) {
      await this.deps.repo.markAnimeUnmatched?.(unmatched);
    }

    if (input.userId) {
      await this.deps.queue.enqueue({
        type: "BACKFILL_SCAN",
        priority: JobPriority.MAINTENANCE,
        payload: { userId: input.userId },
        dedupeKey: `BACKFILL_SCAN:${input.userId}`,
      });
      await this.deps.queue.enqueue({
        type: "AUTO_PLAYLIST_REFRESH",
        priority: JobPriority.NORMAL,
        payload: { userId: input.userId },
        dedupeKey: `AUTO_PLAYLIST_REFRESH:${input.userId}`,
      });
    } else {
      await this.deps.queue.enqueue({
        type: "BACKFILL_SCAN",
        priority: JobPriority.MAINTENANCE,
        payload: {},
        dedupeKey: "BACKFILL_SCAN:all",
      });
    }

    await this.updateProgress(input.job.id, {
      phase: "DONE",
      total: kitsuIds.length,
      mapped: allMapped.size,
      unmatched,
    });
  }

  async runBackfillScan(input: { userId?: string; job: { id: number } }): Promise<void> {
    const themeIds = (await this.deps.repo.getThemeIdsMissingReadyAudio?.(input.userId)) ?? [];
    for (const themeId of themeIds) {
      await this.deps.queue.enqueue({
        type: "FETCH_AUDIO",
        priority: JobPriority.MAINTENANCE,
        payload: { themeId },
        dedupeKey: `FETCH_AUDIO:${themeId}`,
      });
    }
    // Pre-warm poster/cover art too, so first-view screens hit the local cache
    // instead of proxying every image from the origin on demand.
    const images = (await this.deps.repo.getAnimeImagesMissingReady?.(input.userId)) ?? [];
    for (const image of images) {
      await this.deps.queue.enqueue({
        type: "FETCH_IMAGE",
        priority: JobPriority.MAINTENANCE,
        payload: { kind: image.kind, refId: image.refId },
        dedupeKey: `FETCH_IMAGE:${image.kind}:${image.refId}`,
      });
    }
    await this.updateProgress(input.job.id, {
      phase: "DONE",
      enqueued: themeIds.length,
      enqueuedImages: images.length,
    });
  }

  async runAutoPlaylistRefresh(input: { userId: string; job: { id: number } }): Promise<void> {
    await this.deps.repo.refreshAutoPlaylists?.(input.userId);
    await this.updateProgress(input.job.id, { phase: "DONE", userId: input.userId });
  }

  async requeueFailedMedia(): Promise<number> {
    const themeIds = (await this.deps.repo.getFailedAudioThemeIds?.()) ?? [];
    if (themeIds.length === 0) return 0;
    await this.deps.repo.markAudioMediaMissing?.(themeIds.map(String));
    for (const themeId of themeIds) {
      await this.deps.queue.enqueue({
        type: "FETCH_AUDIO",
        priority: JobPriority.MAINTENANCE,
        payload: { themeId },
        dedupeKey: `FETCH_AUDIO:${themeId}`,
      });
    }
    return themeIds.length;
  }

  async scanOrphanFiles(mediaRoot: string): Promise<string[]> {
    const readyPaths = new Set((await this.deps.repo.listReadyMediaFilePaths?.()) ?? []);
    const files = await listFiles(mediaRoot);
    const removed: string[] = [];
    for (const file of files) {
      const rel = normalizeRelativePath(relative(mediaRoot, file));
      // Sonos derivatives are content-addressed and are not represented by
      // READY media rows. This also protects in-flight .tmp.mp3 outputs.
      if (isSonosDerivativePath(rel) || rel.includes("/tmp/") || readyPaths.has(rel)) continue;
      // Do not let maintenance delete a file reached through a symlink or
      // junction that redirects outside the managed media root.
      const managedPath = await resolveManagedMediaPath(mediaRoot, rel).catch(() => null);
      if (!managedPath) continue;
      await rm(managedPath, { force: true });
      removed.push(rel);
    }
    return removed.sort();
  }

  private async upsertGenres(entries: KitsuAnimeEntry[]): Promise<void> {
    const ids = entries.map((entry) => entry.id);
    if (ids.length === 0) return;
    const genresByAnime = await this.deps.kitsu.getAnimeCategories(ids);
    for (const id of ids) {
      const genres = genresByAnime.get(id) ?? [];
      if (genres.length > 0) {
        await this.deps.repo.upsertAnimeGenres(id, genres);
      }
    }
  }

  private async entriesChangedSince(
    userId: string,
    entries: KitsuAnimeEntry[],
    since: Date | null,
  ): Promise<KitsuAnimeEntry[]> {
    if (!since) return entries;
    const cutoff = since.getTime();
    if (!this.deps.repo.getLibraryEntrySyncStates) {
      return entries.filter((entry) => {
        if (!entry.libraryUpdatedAt) return true;
        const updatedAt = Date.parse(entry.libraryUpdatedAt);
        return !Number.isFinite(updatedAt) || updatedAt > cutoff;
      });
    }
    const states = await this.deps.repo.getLibraryEntrySyncStates(userId, entries.map((entry) => entry.id));
    const statesById = new Map(states?.map((state) => [state.kitsuId, state]));
    return entries.filter((entry) => {
      const state = statesById.get(entry.id);
      // A missing local row, tombstone, or deleted catalog row must be
      // repaired even when Kitsu's updatedAt predates the watermark.
      if (!state || state.deletedAt || state.catalogDeletedAt) return true;
      if (state.watchingStatus !== entry.watchingStatus || !sameNumber(state.userRating, entry.userRating)) return true;
      if (!sameDate(state.libraryUpdatedAt, entry.libraryUpdatedAt)) return true;
      if (!sameDate(state.watchedAt, entry.watchedAt)) return true;
      if (!entry.libraryUpdatedAt) return true;
      const updatedAt = Date.parse(entry.libraryUpdatedAt);
      return !Number.isFinite(updatedAt) || updatedAt > cutoff;
    });
  }

  private async entriesNeedingCatalogWork(
    entries: KitsuAnimeEntry[],
    reconcileOnly: boolean,
  ): Promise<KitsuAnimeEntry[]> {
    if (!reconcileOnly || entries.length === 0 || !this.deps.repo.getKitsuAnimeForMapping) return entries;

    const uniqueEntries = entries.filter(
      (entry, index) => entries.findIndex((candidate) => candidate.id === entry.id) === index,
    );
    const records = await this.deps.repo.getKitsuAnimeForMapping(uniqueEntries.map((entry) => entry.id));
    const recordsById = new Map(records.map((record) => [record.kitsuId, record]));
    return uniqueEntries.filter((entry) => {
      const record = recordsById.get(entry.id);
      // A missing row should be retried defensively.  MAPPED rows already
      // have their AnimeThemes catalog; every other state may need mapping.
      return record?.mappingState !== "MAPPED" || record.animethemesAnimeId === null;
    });
  }

  private async enqueueFollowUps(
    userId: string,
    entries: KitsuAnimeEntry[],
    enqueueBackfill: boolean,
  ): Promise<void> {
    const kitsuIds = unique(entries.map((entry) => entry.id));
    if (kitsuIds.length > 0) {
      await this.deps.queue.enqueue({
        type: "MAP_THEMES",
        priority: JobPriority.NORMAL,
        payload: { kitsuIds, userId },
        dedupeKey: `MAP_THEMES:${userId}:${kitsuIds.join(",")}`,
      });
    }
    if (enqueueBackfill) {
      await this.deps.queue.enqueue({
        type: "BACKFILL_SCAN",
        priority: JobPriority.MAINTENANCE,
        payload: { userId },
        dedupeKey: `BACKFILL_SCAN:${userId}`,
      });
    }
    await this.deps.queue.enqueue({
      type: "AUTO_PLAYLIST_REFRESH",
      priority: JobPriority.NORMAL,
      payload: { userId },
      dedupeKey: `AUTO_PLAYLIST_REFRESH:${userId}`,
    });
  }

  private async updateProgress(id: number, progress: Record<string, unknown>): Promise<void> {
    await this.deps.queue.updateProgress(id, progress);
  }

  private async accessTokenForSync(
    userId: string,
    jobId: number,
    user: {
      accessToken: string | null;
      refreshToken: string | null;
      tokenExpiresAt: Date | null;
    },
  ): Promise<string | null> {
    if (!user.accessToken) return null;
    if (!this.shouldRefreshToken(user.tokenExpiresAt)) {
      return user.accessToken;
    }

    if (!user.refreshToken || !this.deps.kitsuAuth) {
      await this.deps.repo.markKitsuReauthRequired(userId);
      await this.updateProgress(jobId, {
        phase: "SKIPPED",
        reason: "REAUTH_REQUIRED",
      });
      return null;
    }

    await this.updateProgress(jobId, { phase: "REFRESHING_KITSU_TOKEN" });
    try {
      const tokens = await this.deps.kitsuAuth.refresh(user.refreshToken);
      const refreshToken = tokens.refreshToken ?? user.refreshToken;
      await this.deps.repo.updateKitsuTokens(userId, {
        accessToken: tokens.accessToken,
        refreshToken,
        expiresAt: tokens.expiresAt,
      });
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof KitsuAuthError) {
        await this.deps.repo.markKitsuReauthRequired(userId);
        await this.updateProgress(jobId, {
          phase: "SKIPPED",
          reason: "REAUTH_REQUIRED",
        });
        return null;
      }
      throw error;
    }
  }

  private shouldRefreshToken(expiresAt: Date | null): boolean {
    if (!expiresAt) return false;
    return expiresAt.getTime() <= this.now().getTime() + TOKEN_REFRESH_SKEW_MS;
  }

  private async mapBatch(
    batch: string[],
    catalog: Map<string, KitsuCatalogRecord>,
    mapped: Map<string, number>,
    savedThemes: AnimeThemeEntry[],
  ): Promise<void> {
    const direct = await this.deps.animeThemes.fetchByKitsuIds?.(batch) ?? emptyLookup();
    applyLookup(direct, mapped, savedThemes, (externalId) => batch.includes(externalId));

    const remainingAfterDirect = batch.filter((id) => !mapped.has(id));
    await this.mapByMal(remainingAfterDirect, mapped, savedThemes);

    for (const kitsuId of remainingAfterDirect.filter((id) => !mapped.has(id))) {
      const record = catalog.get(kitsuId);
      if (!record) continue;
      await this.mapByTitle(record, mapped, savedThemes);
    }
  }

  private async mapByMal(
    kitsuIds: string[],
    mapped: Map<string, number>,
    savedThemes: AnimeThemeEntry[],
  ): Promise<void> {
    if (kitsuIds.length === 0 || !this.deps.kitsu.getAnimeMappings || !this.deps.animeThemes.fetchByMalIds) {
      return;
    }

    const mappingsByKitsu = await this.deps.kitsu.getAnimeMappings(kitsuIds);
    const malToKitsu = new Map<string, string>();
    for (const kitsuId of kitsuIds) {
      const malId = mappingsByKitsu.get(kitsuId)?.["myanimelist/anime"];
      if (malId) malToKitsu.set(malId, kitsuId);
    }
    if (malToKitsu.size === 0) return;

    const lookup = await this.deps.animeThemes.fetchByMalIds([...malToKitsu.keys()]);
    applyLookup(lookup, mapped, savedThemes, (externalId) => malToKitsu.get(externalId) ?? null);
  }

  private async mapByTitle(
    record: KitsuCatalogRecord,
    mapped: Map<string, number>,
    savedThemes: AnimeThemeEntry[],
  ): Promise<void> {
    if (!this.deps.animeThemes.searchByTitle) return;

    const titles = unique([
      record.title,
      record.titleEn,
      record.titleRomaji,
      record.titleJa,
      ...record.abbreviatedTitles,
    ].filter((title): title is string => typeof title === "string" && title.trim().length > 0));

    for (const title of titles) {
      const lookup = await this.deps.animeThemes.searchByTitle(title);
      const matchingTheme = lookup.themes.find((candidate) =>
        titleCandidateMatches(record.kitsuId, titles, candidate),
      );
      if (!matchingTheme) continue;

      const animeId = matchingTheme.animeId;
      mapped.set(record.kitsuId, animeId);
      savedThemes.push(...lookup.themes.filter((candidate) => candidate.animeId === animeId));
      return;
    }
  }

  private async flushMappings(
    themes: AnimeThemeEntry[],
    mappings: Map<string, number>,
  ): Promise<void> {
    await this.deps.repo.saveAnimeThemesCatalog?.(dedupeThemes(themes));
    await this.deps.repo.setAnimeThemeMappings?.(mappings);
    // Discovery is ancillary to library mapping. A provider/database outage
    // must never roll back a valid AnimeThemes mapping or fail normal sync.
    await this.deps.onAnimeMapped?.([...new Set(mappings.values())]).catch(() => undefined);
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.length > 0))];
}

function sameNumber(actual: number | null, expected: number | null): boolean {
  return actual === expected || (actual === null && expected === null);
}

function sameDate(actual: Date | null, expected: string | null | undefined): boolean {
  if (actual === null) return expected === null || expected === undefined;
  const expectedMs = expected ? Date.parse(expected) : null;
  return expectedMs !== null && Number.isFinite(expectedMs) && actual.getTime() === expectedMs;
}

function emptyLookup(): AnimeThemesLookupResult {
  return { mappings: new Map(), themes: [] };
}

function applyLookup(
  lookup: AnimeThemesLookupResult,
  mapped: Map<string, number>,
  savedThemes: AnimeThemeEntry[],
  externalToKitsuId: (externalId: string) => string | boolean | null,
): void {
  for (const [externalId, animeThemesId] of lookup.mappings) {
    const kitsuIdOrAllowed = externalToKitsuId(externalId);
    const kitsuId = kitsuIdOrAllowed === true ? externalId : kitsuIdOrAllowed;
    if (typeof kitsuId === "string") {
      mapped.set(kitsuId, animeThemesId);
    }
  }
  savedThemes.push(...lookup.themes);
}

function titleCandidateMatches(kitsuId: string, titles: string[], candidate: AnimeThemeEntry): boolean {
  if (candidate.kitsuId !== null && candidate.kitsuId !== kitsuId) return false;
  const titleSet = new Set(titles.map(normalizeTitle));
  return [candidate.animeName, candidate.animeNameEn, ...candidate.animeSynonyms]
    .filter((title): title is string => typeof title === "string")
    .some((title) => titleSet.has(normalizeTitle(title)));
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function dedupeThemes(themes: AnimeThemeEntry[]): AnimeThemeEntry[] {
  const byId = new Map<number, AnimeThemeEntry>();
  for (const theme of themes) byId.set(theme.themeId, theme);
  return [...byId.values()];
}

function payloadWithOptionalUser(
  payload: { kitsuIds: string[] },
  userId: string | undefined,
): { kitsuIds: string[]; userId?: string } {
  return userId ? { ...payload, userId } : payload;
}

function mapThemesDedupeKey(userId: string | undefined, kitsuIds: string[]): string {
  return `MAP_THEMES:${userId ?? "all"}:${kitsuIds.join(",")}`;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function isSonosDerivativePath(path: string): boolean {
  return path === "sonos" || path.startsWith("sonos/");
}
function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}
